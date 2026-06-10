import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ConversationReportReason,
  MessageSenderType,
  Prisma,
  StoreStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CloudinaryConfig } from '../uploads/cloudinary-config';
import { SendMessageDto } from './dto/send-message.dto';
import { ReportConversationDto } from './dto/report-conversation.dto';
import { toConversationView, toMessageView } from './chat.serializers';

const STORE_META_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  logoUrl: true,
} as const;

const REPORT_REASON_MAP: Record<string, ConversationReportReason> = {
  harassment: ConversationReportReason.HARASSMENT,
  scam: ConversationReportReason.SCAM,
  spam: ConversationReportReason.SPAM,
  other: ConversationReportReason.OTHER,
};

/**
 * Buyer↔merchant chat — durable source of truth, shared by the buyer app
 * (`/api/conversations/...`) and the merchant dashboard
 * (`/stores/:storeId/conversations/...`). Real-time delivery is layered on by
 * ChatGateway, which calls the emit hooks here after a write. Participant authz
 * is uniform: a user is the BUYER (conversation.buyerId) or a MERCHANT member
 * (canManageStore on conversation.storeId).
 */
@Injectable()
export class ChatService {
  // Set by ChatGateway on init to avoid a circular module dependency. When
  // unset (e.g. unit tests), emits are no-ops.
  emitMessage: (conversationId: string, message: unknown) => void = () => {};
  emitRead: (conversationId: string, by: MessageSenderType) => void = () => {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly cloudinary: CloudinaryConfig,
  ) {}

  /** Buyer-initiated idempotent get-or-create for the (buyer, store) pair. */
  async getOrCreateByMerchant(buyerId: string, username: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug: username },
      select: { ...STORE_META_SELECT, status: true },
    });
    if (!store || store.status !== StoreStatus.ACTIVE) {
      throw new NotFoundException({
        code: 'MERCHANT_NOT_FOUND',
        message: 'Merchant not found',
      });
    }

    const conv = await this.prisma.conversation.upsert({
      where: { buyerId_storeId: { buyerId, storeId: store.id } },
      create: { buyerId, storeId: store.id },
      update: {},
      select: { id: true, buyerLastReadAt: true, createdAt: true },
    });

    const unreadCount = await this.unreadCount(
      conv.id,
      MessageSenderType.BUYER,
      conv.buyerLastReadAt,
    );

    return { conversation: toConversationView(conv, store, unreadCount) };
  }

  /** Message history. `after` = polling (newer), `before` = backward pagination. */
  async getMessages(
    conversationId: string,
    userId: string,
    opts: { limit?: number; before?: string; after?: string },
  ) {
    await this.resolveParticipant(conversationId, userId);
    const take = Math.min(opts.limit ?? 50, 100);

    if (opts.after) {
      const rows = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        cursor: { id: opts.after },
        skip: 1,
        take,
      });
      return {
        messages: rows.map(toMessageView),
        pagination: { limit: take, nextCursor: null, hasMore: rows.length === take },
      };
    }

    const desc = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    });
    const asc = desc.reverse();
    const hasMore = desc.length === take;
    const nextCursor = hasMore && asc.length ? asc[0].id : null; // oldest → next `before`
    return {
      messages: asc.map(toMessageView),
      pagination: { limit: take, nextCursor, hasMore },
    };
  }

  async sendMessage(
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
    idempotencyKey?: string,
  ) {
    const { senderType } = await this.resolveParticipant(conversationId, userId);

    const hasText = !!dto.text && dto.text.trim().length > 0;
    const attachments = this.validateImageAttachments(dto.attachments);
    if (!hasText && (!attachments || attachments.length === 0)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A message must have text or an attachment.',
      });
    }
    if (dto.text && dto.text.length > 2000) {
      throw new UnprocessableEntityException({
        code: 'MESSAGE_TOO_LONG',
        message: 'Message exceeds the 2000 character limit.',
      });
    }

    if (idempotencyKey) {
      const existing = await this.prisma.message.findUnique({
        where: { conversationId_idempotencyKey: { conversationId, idempotencyKey } },
      });
      if (existing) return { message: toMessageView(existing) };
    }

    let created;
    try {
      created = await this.prisma.message.create({
        data: {
          conversationId,
          senderType,
          senderId: userId,
          text: dto.text ?? null,
          attachments: attachments
            ? (attachments as unknown as Prisma.InputJsonValue)
            : undefined,
          orderId: dto.orderRef ?? null,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
    } catch (err) {
      // Concurrent send with the same idempotency key — return the winner.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        idempotencyKey
      ) {
        const existing = await this.prisma.message.findUnique({
          where: { conversationId_idempotencyKey: { conversationId, idempotencyKey } },
        });
        if (existing) return { message: toMessageView(existing) };
      }
      throw err;
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: created.createdAt },
    });

    const view = toMessageView(created);
    this.emitMessage(conversationId, view);
    return { message: view };
  }

  /** Sets the caller's read marker (buyer or merchant). Fire-and-forget. */
  async markRead(conversationId: string, userId: string) {
    const { senderType } = await this.resolveParticipant(conversationId, userId);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data:
        senderType === MessageSenderType.BUYER
          ? { buyerLastReadAt: new Date() }
          : { merchantLastReadAt: new Date() },
    });
    this.emitRead(conversationId, senderType);
  }

  async report(conversationId: string, userId: string, dto: ReportConversationDto) {
    await this.resolveParticipant(conversationId, userId);
    await this.prisma.conversationReport.create({
      data: {
        conversationId,
        reporterId: userId,
        reason: REPORT_REASON_MAP[dto.reason],
        details: dto.details ?? null,
      },
    });
  }

  // ─── Merchant surface ───────────────────────────────────────────────────────

  /** Conversations for a store (merchant dashboard). Authz done by the caller. */
  async listConversationsForStore(storeId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: { storeId },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        merchantLastReadAt: true,
        lastMessageAt: true,
        createdAt: true,
        buyer: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, senderType: true, createdAt: true },
        },
      },
    });

    const conversations = await Promise.all(
      convs.map(async (c) => ({
        id: c.id,
        buyer: {
          id: c.buyer.id,
          name: `${c.buyer.firstName} ${c.buyer.lastName}`.trim(),
          avatar: c.buyer.avatarUrl ?? null,
        },
        lastMessage: c.messages[0]
          ? {
              text: c.messages[0].text ?? null,
              sender:
                c.messages[0].senderType === MessageSenderType.MERCHANT
                  ? 'merchant'
                  : 'user',
              at: c.messages[0].createdAt,
            }
          : null,
        lastMessageAt: c.lastMessageAt,
        unreadCount: await this.unreadCount(
          c.id,
          MessageSenderType.MERCHANT,
          c.merchantLastReadAt,
        ),
      })),
    );

    return { conversations };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /**
   * Resolve who the caller is in a conversation. BUYER when they own it,
   * MERCHANT when they can manage the store. 404 on unknown conversation,
   * 403 when neither (enumeration is bounded by auth-required routes).
   */
  async resolveParticipant(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerId: true, storeId: true },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    if (conversation.buyerId === userId) {
      return { conversation, senderType: MessageSenderType.BUYER };
    }
    if (await this.storeService.canManageStore(userId, conversation.storeId)) {
      return { conversation, senderType: MessageSenderType.MERCHANT };
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You are not a participant in this conversation.',
    });
  }

  private async unreadCount(
    conversationId: string,
    forParticipant: MessageSenderType,
    lastReadAt: Date | null,
  ): Promise<number> {
    // Unread = messages from the OTHER party after my last-read marker.
    const fromOther =
      forParticipant === MessageSenderType.BUYER
        ? MessageSenderType.MERCHANT
        : MessageSenderType.BUYER;
    return this.prisma.message.count({
      where: {
        conversationId,
        senderType: fromOther,
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  private validateImageAttachments(attachments?: unknown[]) {
    if (!attachments || attachments.length === 0) return undefined;
    return attachments.map((raw) => {
      const a = raw as Record<string, unknown>;
      if (a?.type !== 'image' || typeof a.url !== 'string') {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Only image attachments are supported.',
        });
      }
      if (!a.url.startsWith(this.cloudinary.urlPrefix)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Attachment must be an uploaded image.',
        });
      }
      return {
        type: 'image',
        url: a.url,
        thumbnailUrl: typeof a.thumbnailUrl === 'string' ? a.thumbnailUrl : null,
        width: typeof a.width === 'number' ? a.width : null,
        height: typeof a.height === 'number' ? a.height : null,
      };
    });
  }
}
