import { MessageSenderType } from '@prisma/client';

interface MessageRow {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId: string;
  text: string | null;
  attachments: unknown;
  orderId: string | null;
  createdAt: Date;
}

/**
 * nuwa Message → maya Message shape. `sender` is 'user'|'merchant' (maya
 * vocabulary). `status` is always 'sent' in v1 — per-message delivery/read
 * receipts are a v2 concern (CH-6/CH-7); read state is tracked at the
 * conversation level via the lastReadAt markers.
 */
export function toMessageView(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.senderType === MessageSenderType.MERCHANT ? 'merchant' : 'user',
    senderId: m.senderId,
    text: m.text ?? null,
    attachments: (m.attachments as unknown[]) ?? [],
    orderRef: m.orderId ?? null,
    status: 'sent',
    createdAt: m.createdAt,
  };
}

interface StoreMeta {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
}

export function toMerchantMeta(store: StoreMeta) {
  return {
    id: store.id,
    username: store.slug,
    displayName: store.displayName,
    logo: store.logoUrl ?? null,
    isVerified: true,
    messagingEnabled: true,
    // No per-merchant response-time data yet — v1 returns null.
    avgResponseTime: null as string | null,
  };
}

export function toConversationView(
  conv: { id: string; buyerLastReadAt: Date | null; createdAt: Date },
  store: StoreMeta,
  unreadCount: number,
) {
  return {
    id: conv.id,
    merchant: toMerchantMeta(store),
    lastReadAt: conv.buyerLastReadAt ?? null,
    unreadCount,
    createdAt: conv.createdAt,
  };
}
