import { IsOptional, IsString } from 'class-validator';

export class SuggestionsQueryDto {
  /** When provided, autocomplete suggestions would be returned (deferred in v1). */
  @IsOptional()
  @IsString()
  q?: string;
}
