import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateStoreDto {
  // Brand identity
  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  companyName?: string;

  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  story?: string;

  // External website
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  // Visual branding — URLs provided by frontend after uploading to cloud storage
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  // Contact
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  // Business registration
  @IsOptional()
  @IsString()
  businessRegNo?: string;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  // Payout details
  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankBranchCode?: string;

  @IsOptional()
  @IsString()
  bankAccountType?: string;
}
