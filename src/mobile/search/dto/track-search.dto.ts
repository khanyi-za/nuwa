import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import type { GenderParam } from '../../common/gender';

export class TrackSearchDto {
  @IsString()
  @MinLength(1)
  q!: string;

  @IsOptional()
  @IsIn(['women', 'men', 'unisex'])
  genderType?: GenderParam;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  resultCount?: number;
}
