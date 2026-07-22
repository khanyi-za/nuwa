import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { PaystackClient } from '../paystack/paystack-client.service';
import { SetPayoutAccountDto } from './dto/set-payout-account.dto';

/**
 * PayoutAccountService — merchant settlement-account onboarding for split
 * payouts (Paystack migration Phase 6).
 *
 * The merchant's bank details are held by PAYSTACK (subaccount); nuwa stores
 * only `Store.paystackSubaccountCode` + display metadata (bank name, last 4).
 * Once a store has a subaccount, checkout attaches a flat multi-split so the
 * merchant's share settles directly to their bank on Paystack's T+1 cycle.
 * NOTE: Paystack holds a NEW subaccount's first payout for one-time
 * verification — set merchant expectations in the UI.
 *
 * Authz follows the dispatch-address pattern: canManageStore (owner or
 * active accepted employee), 404-not-403 on cross-store access.
 */
@Injectable()
export class PayoutAccountService {
  private readonly logger = new Logger(PayoutAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly client: PaystackClient,
  ) {}

  /** SA bank list (name + code) for the settlement-account form. */
  async listBanks() {
    const banks = await this.client.listBanks();
    return {
      banks: banks
        .filter((b) => b.active)
        .map((b) => ({ name: b.name, code: b.code })),
    };
  }

  async get(userId: string, storeId: string) {
    const store = await this.loadManagedStore(userId, storeId);
    return this.toView(store);
  }

  /**
   * Create (or update) the store's Paystack subaccount from bank details.
   * Idempotent by store: an existing subaccount is updated in place.
   */
  async set(userId: string, storeId: string, dto: SetPayoutAccountDto) {
    const store = await this.loadManagedStore(userId, storeId);

    // Validate the bank code against the live list — also gives us the
    // display name so we never store a code the UI can't explain.
    const banks = await this.client.listBanks();
    const bank = banks.find((b) => b.code === dto.bankCode && b.active);
    if (!bank) {
      throw new BadRequestException({
        code: 'UNKNOWN_BANK_CODE',
        message: 'bankCode does not match an active South African bank',
      });
    }

    const subaccountReq = {
      business_name: dto.businessName?.trim() || store.companyName,
      settlement_bank: dto.bankCode,
      account_number: dto.accountNumber,
      // Overridden per transaction by the flat multi-split; set for
      // dashboard legibility only (current platform commission).
      percentage_charge: 2.5,
      ...(store.contactEmail
        ? { primary_contact_email: store.contactEmail }
        : {}),
    };

    const sub = store.paystackSubaccountCode
      ? await this.client.updateSubaccount(
          store.paystackSubaccountCode,
          subaccountReq,
        )
      : await this.client.createSubaccount(subaccountReq);

    const updated = await this.prisma.store.update({
      where: { id: store.id },
      data: {
        paystackSubaccountCode: sub.subaccount_code,
        payoutBankName: bank.name,
        payoutAccountLast4: dto.accountNumber.slice(-4),
      },
      select: {
        paystackSubaccountCode: true,
        payoutBankName: true,
        payoutAccountLast4: true,
      },
    });

    this.logger.log(
      `Payout account ${store.paystackSubaccountCode ? 'updated' : 'created'} for store ${store.id}: ${sub.subaccount_code}`,
    );

    return this.toView(updated);
  }

  private async loadManagedStore(userId: string, storeId: string) {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      // 404-not-403: don't reveal the store exists to non-managers.
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        companyName: true,
        contactEmail: true,
        paystackSubaccountCode: true,
        payoutBankName: true,
        payoutAccountLast4: true,
      },
    });
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }
    return store;
  }

  private toView(store: {
    paystackSubaccountCode: string | null;
    payoutBankName: string | null;
    payoutAccountLast4: string | null;
  }) {
    return {
      configured: !!store.paystackSubaccountCode,
      subaccountCode: store.paystackSubaccountCode,
      bankName: store.payoutBankName,
      accountLast4: store.payoutAccountLast4,
    };
  }
}
