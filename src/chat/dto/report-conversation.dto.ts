import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportConversationDto {
  @IsIn(['harassment', 'scam', 'spam', 'other'])
  reason!: 'harassment' | 'scam' | 'spam' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
