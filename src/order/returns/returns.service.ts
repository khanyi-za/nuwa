import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, ReturnRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CreateReturnRequestDto } from '../dto/return-request.dto';

/**
 * ReturnsService — returns/exchanges v1 (per-Order; per-item is v2).
 *
 * Buyer requests a return within RETURN_WINDOW_DAYS of delivery (matches the
 * 30-day policy shown on the product page). The maya "order" is a
 * PaymentGroup, so a buyer request fans out to every eligible DELIVERED child
 * order (usually one). Merchant then drives the lifecycle:
 *
 *   REQUESTED → APPROVED → RECEIVED → CLOSED
 *   REQUESTED → REJECTED (terminal)
 *
 * Money movement is NOT here — once the parcel is RECEIVED, the refund goes
 * through the existing admin refund tool (Paystack), and the merchant/ops closes
 * the request. 404-not-403 for cross-user/cross-store access throughout.
 */

const RETURN_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const OPEN_STATUSES: ReturnRequestStatus[] = [
  ReturnRequestStatus.REQUESTED,
  ReturnRequestStatus.APPROVED,
  ReturnRequestStatus.RECEIVED,
];

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  // ─── Buyer side (mobile) ─────────────────────────────────────────────────

  /**
   * Create return requests for the eligible child orders of a PaymentGroup.
   * Throws 404 if the group isn't the buyer's; 409 if nothing is eligible.
   */
  async requestReturn(
    userId: string,
    paymentGroupId: string,
    dto: CreateReturnRequestDto,
  ) {
    // Ownership goes through the child orders (PaymentGroup has no userId).
    const group = await this.prisma.paymentGroup.findFirst({
      where: { id: paymentGroupId, payments: { some: { order: { userId } } } },
      select: {
        id: true,
        payments: {
          select: {
            order: {
              select: {
                id: true,
                storeId: true,
                status: true,
                deliveredAt: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const windowStart = new Date(
      Date.now() - RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const candidates = group.payments
      .map((p) => p.order)
      .filter(
        (o) =>
          o.status === OrderStatus.DELIVERED &&
          o.deliveredAt !== null &&
          o.deliveredAt >= windowStart,
      );

    if (candidates.length === 0) {
      throw new ConflictException({
        code: 'RETURN_NOT_ELIGIBLE',
        message: `Returns are available for ${RETURN_WINDOW_DAYS} days after delivery.`,
      });
    }

    const existingOpen = await this.prisma.returnRequest.findMany({
      where: {
        orderId: { in: candidates.map((o) => o.id) },
        status: { in: OPEN_STATUSES },
      },
      select: { orderId: true },
    });
    const blocked = new Set(existingOpen.map((r) => r.orderId));
    const eligible = candidates.filter((o) => !blocked.has(o.id));

    if (eligible.length === 0) {
      throw new ConflictException({
        code: 'RETURN_ALREADY_OPEN',
        message: 'A return is already in progress for this order.',
      });
    }

    const created = await this.prisma.$transaction(
      eligible.map((order) =>
        this.prisma.returnRequest.create({
          data: {
            orderId: order.id,
            storeId: order.storeId,
            buyerId: userId,
            reason: dto.reason,
            details: dto.details?.trim() || null,
          },
          select: {
            id: true,
            orderId: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        }),
      ),
    );

    return { returns: created };
  }

  /** Buyer's return requests for one consolidated (PaymentGroup) order. */
  async listForBuyerOrder(userId: string, paymentGroupId: string) {
    const group = await this.prisma.paymentGroup.findFirst({
      where: { id: paymentGroupId, payments: { some: { order: { userId } } } },
      select: { payments: { select: { orderId: true } } },
    });
    if (!group) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const returns = await this.prisma.returnRequest.findMany({
      where: { orderId: { in: group.payments.map((p) => p.orderId) } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        reason: true,
        details: true,
        status: true,
        merchantNotes: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    return { returns };
  }

  // ─── Merchant side ───────────────────────────────────────────────────────

  async listForStore(
    userId: string,
    storeId: string,
    opts: { status?: string; cursor?: string; take?: string } = {},
  ) {
    await this.assertCanManage(userId, storeId);

    const take = Math.min(
      parseInt(opts.take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const where: {
      storeId: string;
      status?: ReturnRequestStatus;
    } = { storeId };
    if (opts.status) {
      if (
        !Object.values(ReturnRequestStatus).includes(
          opts.status as ReturnRequestStatus,
        )
      ) {
        throw new BadRequestException('Invalid status filter');
      }
      where.status = opts.status as ReturnRequestStatus;
    }

    const rows = await this.prisma.returnRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        merchantNotes: true,
        createdAt: true,
        resolvedAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalInCents: true,
            deliveredAt: true,
          },
        },
        buyer: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      returns: page.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        merchantNotes: r.merchantNotes,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        order: r.order,
        buyer: {
          name: `${r.buyer.firstName} ${r.buyer.lastName}`,
          email: r.buyer.email,
        },
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  approve(userId: string, storeId: string, returnId: string, notes?: string) {
    return this.transition(userId, storeId, returnId, {
      from: [ReturnRequestStatus.REQUESTED],
      to: ReturnRequestStatus.APPROVED,
      notes,
    });
  }

  reject(userId: string, storeId: string, returnId: string, notes?: string) {
    return this.transition(userId, storeId, returnId, {
      from: [ReturnRequestStatus.REQUESTED],
      to: ReturnRequestStatus.REJECTED,
      notes,
      resolve: true,
    });
  }

  markReceived(
    userId: string,
    storeId: string,
    returnId: string,
    notes?: string,
  ) {
    return this.transition(userId, storeId, returnId, {
      from: [ReturnRequestStatus.APPROVED],
      to: ReturnRequestStatus.RECEIVED,
      notes,
    });
  }

  /** Close after the admin refund (or exchange) has been handled. */
  close(userId: string, storeId: string, returnId: string, notes?: string) {
    return this.transition(userId, storeId, returnId, {
      from: [ReturnRequestStatus.RECEIVED],
      to: ReturnRequestStatus.CLOSED,
      notes,
      resolve: true,
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async transition(
    userId: string,
    storeId: string,
    returnId: string,
    opts: {
      from: ReturnRequestStatus[];
      to: ReturnRequestStatus;
      notes?: string;
      resolve?: boolean;
    },
  ) {
    await this.assertCanManage(userId, storeId);

    const request = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      select: { id: true, storeId: true, status: true },
    });
    if (!request || request.storeId !== storeId) {
      throw new NotFoundException('Return request not found');
    }
    if (!opts.from.includes(request.status)) {
      throw new BadRequestException(
        `Cannot move a ${request.status} return to ${opts.to}.`,
      );
    }

    return this.prisma.returnRequest.update({
      where: { id: returnId },
      data: {
        status: opts.to,
        ...(opts.notes !== undefined && { merchantNotes: opts.notes }),
        ...(opts.resolve && { resolvedAt: new Date() }),
      },
      select: { id: true, status: true, merchantNotes: true, resolvedAt: true },
    });
  }

  private async assertCanManage(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage returns for this store',
      );
    }
  }
}
