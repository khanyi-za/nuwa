import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum CancelReason {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  CANNOT_FULFILL = 'CANNOT_FULFILL',
  OTHER = 'OTHER',
}

export class CancelOrderDto {
  @IsEnum(CancelReason)
  reason!: CancelReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
