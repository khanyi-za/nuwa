import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { GenderParam } from '../../common/gender';

export class FeedQueryDto {
  @IsIn(['women', 'men', 'unisex'])
  genderType!: GenderParam;

  /** Category slug from GET /api/categories. */
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  /** Opaque cursor (preferred pagination). */
  @IsOptional()
  @IsString()
  cursor?: string;
}
