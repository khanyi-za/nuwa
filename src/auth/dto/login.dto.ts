import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
