import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  /** Backward pagination — messages older than this messageId. */
  @IsOptional()
  @IsString()
  before?: string;

  /** Polling — messages newer than this messageId. */
  @IsOptional()
  @IsString()
  after?: string;
}
