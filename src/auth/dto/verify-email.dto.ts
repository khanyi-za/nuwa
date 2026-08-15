import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';

export class VerifyEmailDto {
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  @IsEmail()
  email: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}
