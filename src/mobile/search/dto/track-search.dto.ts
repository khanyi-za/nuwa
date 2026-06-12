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

  /**
   * Result-click variant (phalo-search.md S2): present when the user tapped a
   * result card. Recorded as a `search_click` event — the ranking feedback
   * signal (CTR, click position) Phalo trains on.
   */
  @IsOptional()
  @IsString()
  clickedProductId?: string;

  /** 0-based position of the clicked card in the result list. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}
