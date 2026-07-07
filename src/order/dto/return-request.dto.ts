import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Buyer-facing reasons — vocabulary strings, same convention as cancel reasons. */
export const RETURN_REASONS = [
  'WRONG_SIZE',
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'CHANGED_MIND',
  'OTHER',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

/** Body of POST /api/orders/:orderId/returns (buyer). */
export class CreateReturnRequestDto {
  @IsIn(RETURN_REASONS)
  reason: ReturnReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

/** Body of merchant return actions (approve / reject / received / close). */
export class ReturnActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
