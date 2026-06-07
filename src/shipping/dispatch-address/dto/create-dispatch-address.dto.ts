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
 * Create-dispatch-address payload. A merchant's parcel collection origin for
 * ShipLogic. All address fields except `addressLine2`, `suburb`, `label`,
 * `latitude`, `longitude` and `isPrimary` are required. Phone accepts
 * `0XXXXXXXXX` or `+27XXXXXXXXX`; the service normalizes to `+27XXXXXXXXX`.
 *
 * First dispatch address for a store is auto-promoted to `isPrimary: true`
 * regardless of the request body.
 */
export class CreateDispatchAddressDto {
  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsString()
  @Length(2, 100)
  contactName: string;

  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  contactPhone: string;

  @IsString()
  @Length(1, 200)
  addressLine1: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(100)
  suburb?: string;

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
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
