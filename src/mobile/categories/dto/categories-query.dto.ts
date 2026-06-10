import { IsIn, IsOptional } from 'class-validator';
import type { GenderParam } from '../../common/gender';

export class CategoriesQueryDto {
  // Accepted for forward-compat with the gendered category sets maya expects.
  // Categories are admin-created and not gendered in nuwa today — see service.
  @IsOptional()
  @IsIn(['women', 'men', 'unisex'])
  genderType?: GenderParam;
}
