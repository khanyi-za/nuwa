import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * CreateSaleCampaignDto — body of POST /stores/:storeId/sales.
 *
 * discountValue semantics depend on discountType:
 *   PERCENTAGE   → whole percent, 1–90 (validated service-side)
 *   FIXED_AMOUNT → cents off per product
 * The campaign applies immediately; endsAt (optional) auto-ends it via cron.
 */
export class CreateSaleCampaignDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountValue: number;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  productIds: string[];
}
