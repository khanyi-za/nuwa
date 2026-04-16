import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { SA_PROVINCES } from './sa-provinces';

/**
 * Update-address payload. Every field is optional — only the keys sent are
 * applied. Validators mirror {@link CreateAddressDto}. See the service for
 * rules around `isDefault` switches (unset-default is rejected — promote
 * another address instead).
 */
export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

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
  @IsBoolean()
  isDefault?: boolean;
}
