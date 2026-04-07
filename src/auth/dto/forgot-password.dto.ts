import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  @IsEmail()
  email: string;
}
