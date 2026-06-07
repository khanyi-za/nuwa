import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { SA_PROVINCES } from '../../../order/dto/sa-provinces';

/**
 * Update-dispatch-address payload. Every field is optional — only the keys
 * sent are applied. Validators mirror {@link CreateDispatchAddressDto}.
 *
 * Unset-isPrimary via PATCH is rejected by the service (use POST /:id/set-primary
 * to promote a different address instead).
 */
export class UpdateDispatchAddressDto {
  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  contactName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @IsOptional()
  @IsIn(SA_PROVINCES, {
    message: 'Province must be one of the 9 South African provinces.',
  })
  province?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postal code must be 4 digits.' })
  postalCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
