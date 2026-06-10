import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  // v1: image attachments only (each must be an uploaded Cloudinary URL —
  // validated in the service). Up to 5 per message.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  attachments?: unknown[];

  /** Order id for context (chat opened from Track Order). */
  @IsOptional()
  @IsString()
  orderRef?: string;
}
