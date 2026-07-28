import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { GenderParam } from '../../common/gender';

export class NewArrivalsQueryDto {
  @IsIn(['women', 'men', 'unisex'])
  genderType!: GenderParam;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 6;

  /** Offset cursor — the "See All" browse screen pages; the rail never sends it. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
