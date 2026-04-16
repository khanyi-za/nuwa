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
 * Create-address payload. All fields except `label`, `addressLine2`, and
 * `isDefault` are required. Phone accepts `0XXXXXXXXX` or `+27XXXXXXXXX`
 * (with optional spaces / dashes / parens); the service normalizes to
 * `+27XXXXXXXXX` before persisting.
 */
export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  label?: string;

  @IsString()
  @Length(2, 100)
  recipientName: string;

  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  phone: string;

  @IsString()
  @Length(1, 200)
  addressLine1: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

  @IsString()
  @Length(1, 100)
  city: string;

  @IsIn(SA_PROVINCES, {
    message: 'Province must be one of the 9 South African provinces.',
  })
  province: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postal code must be 4 digits.' })
  postalCode: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
