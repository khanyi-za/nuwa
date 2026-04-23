import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminEditOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddress1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddress2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingProvince?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  shippingPostalCode?: string;
}
