import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import type { GenderParam } from '../../common/gender';

export class SmartCategorySearchDto {
  @IsString()
  @MinLength(1)
  smartCategory!: string;

  @IsOptional()
  @IsIn(['women', 'men', 'unisex'])
  genderType?: GenderParam;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}
