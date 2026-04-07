import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStoreDto {
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  companyName: string;

  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  story?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsUrl()
  websiteUrl?: string;
}
