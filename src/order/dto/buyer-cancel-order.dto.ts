import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum BuyerCancelReason {
  CHANGED_MIND = 'CHANGED_MIND',
  ORDERED_BY_MISTAKE = 'ORDERED_BY_MISTAKE',
  FOUND_CHEAPER = 'FOUND_CHEAPER',
  OTHER = 'OTHER',
}

export class BuyerCancelOrderDto {
  @IsEnum(BuyerCancelReason)
  reason!: BuyerCancelReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
