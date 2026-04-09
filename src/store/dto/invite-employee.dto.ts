import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class InviteEmployeeDto {
  @Transform(({ value }) => (value as string).trim().toLowerCase())
  @IsEmail()
  email: string;
}
