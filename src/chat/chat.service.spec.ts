import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CloudinaryConfig } from './../uploads/cloudinary-config';
import { ChatService } from './chat.service';

const CLOUD_PREFIX = 'https://res.cloudinary.com/yiiva-dev/';

const mockPrisma = {
  store: { findUnique: jest.fn() },
  conversation: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  message: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  conversationReport: { create: jest.fn() },
};
const mockStore = { canManageStore: jest.fn() };
const mockCloudinary = { urlPrefix: CLOUD_PREFIX };

// resolveParticipant looks up the conversation; buyer = u1, store = s1.
const convRow = { id: 'c1', buyerId: 'u1', storeId: 's1' };

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStore },
        { provide: CloudinaryConfig, useValue: mockCloudinary },
      ],
    }).compile();
    service = module.get(ChatService);
    jest.clearAllMocks();
  });

  describe('getOrCreateByMerchant', () => {
    it('upserts a conversation and returns the merchant view', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 's1',
        slug: 'tol_thema',
        displayName: "Tol'thema",
        logoUrl: 'https://cdn/logo.png',
        status: 'ACTIVE',
      });
      mockPrisma.conversation.upsert.mockResolvedValue({
        id: 'c1',
        buyerLastReadAt: null,
        createdAt: new Date(),
      });
      mockPrisma.message.count.mockResolvedValue(0);

      const { conversation } = await service.getOrCreateByMerchant(
        'u1',
        'tol_thema',
      );

      expect(conversation.id).toBe('c1');
      expect(conversation.merchant).toMatchObject({
        username: 'tol_thema',
        messagingEnabled: true,
        avgResponseTime: null,
      });
      expect(conversation.unreadCount).toBe(0);
    });

    it('404s an unknown / inactive merchant', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);
      await expect(
        service.getOrCreateByMerchant('u1', 'nope'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockPrisma.conversation.update.mockResolvedValue({});
    });

    it('persists a buyer text message and emits it', async () => {
      const emit = jest.fn();
      service.emitMessage = emit;
      mockPrisma.message.create.mockResolvedValue({
        id: 'm1',
        conversationId: 'c1',
        senderType: 'BUYER',
        senderId: 'u1',
        text: 'Hi',
        attachments: null,
        orderId: null,
        createdAt: new Date(),
      });

      const { message } = await service.sendMessage('c1', 'u1', { text: 'Hi' });

      expect(message).toMatchObject({ sender: 'user', text: 'Hi', status: 'sent' });
      expect(emit).toHaveBeenCalledWith('c1', message);
    });

    it('resolves the merchant as sender via canManageStore', async () => {
      mockStore.canManageStore.mockResolvedValue(true);
      mockPrisma.message.create.mockResolvedValue({
        id: 'm2',
        conversationId: 'c1',
        senderType: 'MERCHANT',
        senderId: 'merchant-1',
        text: 'Yes we do',
        attachments: null,
        orderId: null,
        createdAt: new Date(),
      });

      const { message } = await service.sendMessage('c1', 'merchant-1', {
        text: 'Yes we do',
      });
      expect(message.sender).toBe('merchant');
      const createArg = mockPrisma.message.create.mock.calls[0][0].data;
      expect(createArg.senderType).toBe('MERCHANT');
    });

    it('rejects an empty message (no text, no attachments)', async () => {
      await expect(service.sendMessage('c1', 'u1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects text over 2000 chars with 422', async () => {
      await expect(
        service.sendMessage('c1', 'u1', { text: 'x'.repeat(2001) }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts a valid Cloudinary image attachment', async () => {
      mockPrisma.message.create.mockResolvedValue({
        id: 'm3',
        conversationId: 'c1',
        senderType: 'BUYER',
        senderId: 'u1',
        text: null,
        attachments: [{ type: 'image', url: `${CLOUD_PREFIX}a.jpg` }],
        orderId: null,
        createdAt: new Date(),
      });

      await service.sendMessage('c1', 'u1', {
        attachments: [{ type: 'image', url: `${CLOUD_PREFIX}a.jpg` }],
      });
      expect(mockPrisma.message.create).toHaveBeenCalled();
    });

    it('rejects a non-Cloudinary attachment URL', async () => {
      await expect(
        service.sendMessage('c1', 'u1', {
          attachments: [{ type: 'image', url: 'https://evil.com/a.jpg' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the existing message for a repeated idempotency key', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        conversationId: 'c1',
        senderType: 'BUYER',
        senderId: 'u1',
        text: 'Hi',
        attachments: null,
        orderId: null,
        createdAt: new Date(),
      });

      const { message } = await service.sendMessage(
        'c1',
        'u1',
        { text: 'Hi' },
        'key-123',
      );
      expect(message.id).toBe('m1');
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveParticipant / authz', () => {
    it('403s a user who is neither buyer nor store manager', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockStore.canManageStore.mockResolvedValue(false);
      await expect(service.markRead('c1', 'stranger')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s an unknown conversation', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);
      await expect(service.markRead('nope', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markRead', () => {
    it('sets the buyer read marker + emits', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockPrisma.conversation.update.mockResolvedValue({});
      const emit = jest.fn();
      service.emitRead = emit;

      await service.markRead('c1', 'u1');

      const data = mockPrisma.conversation.update.mock.calls[0][0].data;
      expect(data.buyerLastReadAt).toBeInstanceOf(Date);
      expect(emit).toHaveBeenCalledWith('c1', 'BUYER');
    });

    it('sets the merchant read marker for a store manager', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockStore.canManageStore.mockResolvedValue(true);
      mockPrisma.conversation.update.mockResolvedValue({});

      await service.markRead('c1', 'merchant-1');
      const data = mockPrisma.conversation.update.mock.calls[0][0].data;
      expect(data.merchantLastReadAt).toBeInstanceOf(Date);
    });
  });

  describe('report', () => {
    it('records a report from a participant', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockPrisma.conversationReport.create.mockResolvedValue({});

      await service.report('c1', 'u1', { reason: 'spam' });
      expect(mockPrisma.conversationReport.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          reporterId: 'u1',
          reason: 'SPAM',
          details: null,
        },
      });
    });
  });

  describe('getMessages', () => {
    it('returns messages chronologically (newest page reversed to ASC)', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(convRow);
      mockPrisma.message.findMany.mockResolvedValue([
        { id: 'm2', conversationId: 'c1', senderType: 'BUYER', senderId: 'u1', text: 'second', attachments: null, orderId: null, createdAt: new Date('2026-06-05T10:01:00Z') },
        { id: 'm1', conversationId: 'c1', senderType: 'BUYER', senderId: 'u1', text: 'first', attachments: null, orderId: null, createdAt: new Date('2026-06-05T10:00:00Z') },
      ]);

      const result = await service.getMessages('c1', 'u1', { limit: 50 });
      expect(result.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    });
  });
});
