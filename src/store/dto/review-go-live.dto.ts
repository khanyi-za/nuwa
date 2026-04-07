import { IsEnum, IsNotEmpty, IsString, MinLength, ValidateIf } from 'class-validator';

export enum GoLiveDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewGoLiveDto {
  @IsEnum(GoLiveDecision)
  decision: GoLiveDecision;

  @ValidateIf((o) => o.decision === GoLiveDecision.REJECT)
  @IsNotEmpty({ message: 'A rejection reason is required' })
  @IsString()
  @MinLength(10, { message: 'Rejection reason must be at least 10 characters' })
  reason?: string;
}
