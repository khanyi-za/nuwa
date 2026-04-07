import { IsEnum, IsNotEmpty, IsString, MinLength, ValidateIf } from 'class-validator';

export enum ReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewStoreDto {
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @ValidateIf((o) => o.decision === ReviewDecision.REJECT)
  @IsNotEmpty({ message: 'A rejection reason is required' })
  @IsString()
  @MinLength(10, { message: 'Rejection reason must be at least 10 characters' })
  reason?: string;
}
