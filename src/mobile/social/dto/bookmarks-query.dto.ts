import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BookmarksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;

  // Accepted per WL-3. v1 effective values: newest (default) / oldest.
  // price_asc / price_desc / merchant deferred to v2.
  @IsOptional()
  @IsIn(['newest', 'oldest', 'price_asc', 'price_desc', 'merchant'])
  sort?: string = 'newest';
}
