import { IsString, MinLength } from 'class-validator';

/**
 * DELETE /auth/account — the caller must re-enter their password so a stolen
 * unlocked phone (valid JWT) cannot destroy the account on its own.
 */
export class DeleteAccountDto {
  @IsString()
  @MinLength(1)
  password: string;
}
