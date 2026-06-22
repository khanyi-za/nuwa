import { Test } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PushService } from './push.service';
import { NotificationsService } from './notifications.service';

const groupRow = {
  amountGrossInCents: 226400,
  payments: [
    {
      order: {
        orderNumber: 'YV-2026-000142',
        user: { id: 'u1', email: 'buyer@example.com', firstName: 'Jane' },
      },
    },
  ],
};

const orderRow = {
  orderNumber: 'YV-2026-000142',
  user: { id: 'u1', email: 'buyer@example.com', firstName: 'Jane' },
  payment: { paymentGroupId: 'pg1' },
};

const mockPrisma = {
  notification: { create: jest.fn() },
  paymentGroup: { findUnique: jest.fn() },
  order: { findUnique: jest.fn() },
};
const mockEmail = { send: jest.fn() };
const mockPush = { sendToUser: jest.fn() };

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: PushService, useValue: mockPush },
      ],
    }).compile();
    service = module.get(NotificationsService);
    jest.clearAllMocks();
  });

  describe('orderConfirmed', () => {
    it('writes an inbox row, sends the email + push for the group', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(groupRow);

      await service.orderConfirmed('pg1');

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: NotificationType.ORDER_CONFIRMED,
            data: { orderId: 'pg1', orderNumber: 'YV-2026-000142' },
          }),
        }),
      );
      expect(mockPush.sendToUser).toHaveBeenCalledWith('u1', expect.any(Object));
      expect(mockEmail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'buyer@example.com' }),
      );
    });

    it('no-ops when the group is missing', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
      await service.orderConfirmed('missing');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
    });
  });

  describe('orderStatusChanged', () => {
    it('deep-links via the PaymentGroup id (not the Order id)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderRow);

      await service.orderStatusChanged('o1', 'delivered');

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.ORDER_DELIVERED,
            data: { orderId: 'pg1', orderNumber: 'YV-2026-000142' },
          }),
        }),
      );
    });
  });

  describe('best-effort contract', () => {
    it('never throws when the inbox write fails', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(groupRow);
      mockPrisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.orderConfirmed('pg1')).resolves.toBeUndefined();
      // Push + email are still attempted despite the row failure.
      expect(mockPush.sendToUser).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
    });
  });
});
