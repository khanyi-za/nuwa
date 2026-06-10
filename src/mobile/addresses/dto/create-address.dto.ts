import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { SA_PROVINCES } from '../../../order/dto/sa-provinces';

/**
 * maya address create body (addresses.md §2). Uses maya field names
 * (`line1`/`line2`); the service maps them to nuwa's `addressLine1`/
 * `addressLine2`. Validation mirrors nuwa's CreateAddressDto.
 */
export class CreateMobileAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  label?: string;

  @IsString()
  @Length(2, 100)
  recipientName!: string;

  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  phone!: string;

  @IsString()
  @Length(1, 200)
  line1!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  line2?: string;

  @IsString()
  @Length(1, 100)
  city!: string;

  @IsIn(SA_PROVINCES, {
    message: 'Province must be one of the 9 South African provinces.',
  })
  province!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postal code must be 4 digits.' })
  postalCode!: string;

  // v1 is South Africa only; accepted for forward-compat, validated to ZA.
  @IsOptional()
  @IsIn(['ZA'], { message: 'Only ZA is supported in v1.' })
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
