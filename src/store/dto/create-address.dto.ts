import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAddressDto {
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(20)
  streetNumber: string;

  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  streetName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  buildingName?: string;

  // SA address component — sits between building name and city (e.g. "Rosebank")
  @IsOptional()
  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MaxLength(100)
  suburb?: string;

  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @Transform(({ value }) => (value as string).trim())
  @IsString()
  @MinLength(4)
  @MaxLength(10)
  postalCode: string;
}
