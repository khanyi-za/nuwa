import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * SetPayoutAccountDto — body of POST /stores/:storeId/payout-account.
 * The bank details go straight to Paystack (subaccount creation); nuwa
 * persists only the subaccount code + display metadata.
 */
export class SetPayoutAccountDto {
  /** Bank code from GET /stores/:storeId/payout-account/banks. */
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'bankCode must be a Paystack bank code' })
  bankCode: string;

  /** SA bank account number (digits only). */
  @IsString()
  @Matches(/^\d{6,13}$/, {
    message: 'accountNumber must be 6–13 digits',
  })
  accountNumber: string;

  /** Defaults to the store's registered company name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string;
}
