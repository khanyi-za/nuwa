import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { PayoutAccountService } from './payout-account.service';
import { PaystackClient } from '../paystack/paystack-client.service';

const USER_ID = 'user-1';
const STORE_ID = 'store-1';

const mockPrisma = {
  store: { findUnique: jest.fn(), update: jest.fn() },
};
const mockStoreService = { canManageStore: jest.fn() };
const mockClient = {
  listBanks: jest.fn(),
  createSubaccount: jest.fn(),
  updateSubaccount: jest.fn(),
};

const BANKS = [
  { name: 'FNB', code: '250655', active: true, currency: 'ZAR' },
  { name: 'Capitec', code: '470010', active: true, currency: 'ZAR' },
  { name: 'Dead Bank', code: '000000', active: false, currency: 'ZAR' },
];

const storeRow = {
  id: STORE_ID,
  companyName: 'FIELDS (Pty) Ltd',
  contactEmail: 'owner@fields.co.za',
  paystackSubaccountCode: null,
  payoutBankName: null,
  payoutAccountLast4: null,
};

describe('PayoutAccountService', () => {
  let service: PayoutAccountService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayoutAccountService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
        { provide: PaystackClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(PayoutAccountService);
    jest.clearAllMocks();
    mockStoreService.canManageStore.mockResolvedValue(true);
    mockClient.listBanks.mockResolvedValue(BANKS);
  });

  describe('listBanks', () => {
    it('returns only active banks as name+code pairs', async () => {
      const { banks } = await service.listBanks();
      expect(banks).toEqual([
        { name: 'FNB', code: '250655' },
        { name: 'Capitec', code: '470010' },
      ]);
    });
  });

  describe('get', () => {
    it('404s when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);
      await expect(service.get(USER_ID, STORE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.store.findUnique).not.toHaveBeenCalled();
    });

    it('reports unconfigured when no subaccount exists', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      const view = await service.get(USER_ID, STORE_ID);
      expect(view).toEqual({
        configured: false,
        subaccountCode: null,
        bankName: null,
        accountLast4: null,
      });
    });
  });

  describe('set', () => {
    it('creates a subaccount, persists code + display metadata', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockClient.createSubaccount.mockResolvedValue({
        subaccount_code: 'ACCT_abc123',
      });
      mockPrisma.store.update.mockResolvedValue({
        paystackSubaccountCode: 'ACCT_abc123',
        payoutBankName: 'FNB',
        payoutAccountLast4: '6789',
      });

      const view = await service.set(USER_ID, STORE_ID, {
        bankCode: '250655',
        accountNumber: '62001236789',
      });

      const req = mockClient.createSubaccount.mock.calls[0][0];
      expect(req.business_name).toBe('FIELDS (Pty) Ltd'); // falls back to companyName
      expect(req.settlement_bank).toBe('250655');
      expect(req.account_number).toBe('62001236789');
      expect(req.primary_contact_email).toBe('owner@fields.co.za');

      // Persists code + display metadata, never the account number.
      const update = mockPrisma.store.update.mock.calls[0][0];
      expect(update.data).toEqual({
        paystackSubaccountCode: 'ACCT_abc123',
        payoutBankName: 'FNB',
        payoutAccountLast4: '6789',
      });

      expect(view.configured).toBe(true);
      expect(view.subaccountCode).toBe('ACCT_abc123');
    });

    it('updates the existing subaccount in place (idempotent by store)', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        ...storeRow,
        paystackSubaccountCode: 'ACCT_existing',
      });
      mockClient.updateSubaccount.mockResolvedValue({
        subaccount_code: 'ACCT_existing',
      });
      mockPrisma.store.update.mockResolvedValue({
        paystackSubaccountCode: 'ACCT_existing',
        payoutBankName: 'Capitec',
        payoutAccountLast4: '4321',
      });

      await service.set(USER_ID, STORE_ID, {
        bankCode: '470010',
        accountNumber: '1234554321',
      });

      expect(mockClient.updateSubaccount).toHaveBeenCalledWith(
        'ACCT_existing',
        expect.objectContaining({ settlement_bank: '470010' }),
      );
      expect(mockClient.createSubaccount).not.toHaveBeenCalled();
    });

    it('rejects unknown or inactive bank codes with 400', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);

      await expect(
        service.set(USER_ID, STORE_ID, {
          bankCode: '000000', // inactive
          accountNumber: '1234567890',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockClient.createSubaccount).not.toHaveBeenCalled();
    });

    it('an explicit businessName overrides the company name', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockClient.createSubaccount.mockResolvedValue({ subaccount_code: 'A' });
      mockPrisma.store.update.mockResolvedValue({
        paystackSubaccountCode: 'A',
        payoutBankName: 'FNB',
        payoutAccountLast4: '6789',
      });

      await service.set(USER_ID, STORE_ID, {
        bankCode: '250655',
        accountNumber: '62001236789',
        businessName: 'F I E L D S',
      });

      expect(mockClient.createSubaccount.mock.calls[0][0].business_name).toBe(
        'F I E L D S',
      );
    });

    it('404s for non-managers before touching Paystack', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);
      await expect(
        service.set(USER_ID, STORE_ID, {
          bankCode: '250655',
          accountNumber: '62001236789',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockClient.listBanks).not.toHaveBeenCalled();
      expect(mockClient.createSubaccount).not.toHaveBeenCalled();
    });
  });
});
