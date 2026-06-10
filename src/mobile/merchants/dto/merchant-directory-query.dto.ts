import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { GenderParam } from '../../common/gender';

export class MerchantDirectoryQueryDto {
  @IsOptional()
  @IsIn(['women', 'men', 'unisex'])
  genderType?: GenderParam;

  /** Single-letter filter — brands whose displayName starts with it. */
  @IsOptional()
  @IsString()
  @Length(1, 1)
  letter?: string;

  @IsOptional()
  @IsIn(['name_asc', 'name_desc', 'newest', 'popularity'])
  sort?: string = 'name_asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @IsOptional()
  @IsString()
  cursor?: string;
}
