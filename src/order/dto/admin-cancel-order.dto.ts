import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum AdminCancelReason {
  FRAUD = 'FRAUD',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  MERCHANT_REQUEST = 'MERCHANT_REQUEST',
  OTHER = 'OTHER',
}

export class AdminCancelOrderDto {
  @IsEnum(AdminCancelReason)
  reason!: AdminCancelReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
