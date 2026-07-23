import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SA_PROVINCES } from './sa-provinces';

/**
 * Inline delivery address for guest checkout. Mirrors `CreateAddressDto`
 * minus `isDefault` and `label` (auto-defaulted in the commit path).
 */
export class GuestAddressDto {
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

  // SA suburb — ShipLogic's `local_area` geocoding anchor (see
  // CreateAddressDto.suburb). Optional but improves delivery accuracy in
  // outlying areas.
  @IsOptional()
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
}

/**
 * Guest checkout identity + delivery address. Required when no JWT is
 * present. The commit path materializes a `User{ isGuestAccount: true }` +
 * `Address` from this payload.
 */
export class GuestInfoDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(1, 50)
  firstName: string;

  @IsString()
  @Length(1, 50)
  lastName: string;

  @IsString()
  @Matches(/^(?:\+?27|0)\d{9}$/, {
    message: 'Phone must be a valid SA number (0XXXXXXXXX or +27XXXXXXXXX).',
  })
  phone: string;

  @ValidateNested()
  @Type(() => GuestAddressDto)
  address: GuestAddressDto;
}
