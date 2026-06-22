import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}

export class RemovePushTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
