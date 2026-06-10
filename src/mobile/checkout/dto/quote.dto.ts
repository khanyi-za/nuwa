import { IsString, MinLength } from 'class-validator';

export class QuoteDto {
  @IsString()
  @MinLength(1)
  addressId!: string;
}
