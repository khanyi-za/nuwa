import { GenderType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * StartImportDto — body of POST /shopify/import.
 *
 * defaultGenderType: applied to products whose gender the heuristics could
 * NOT infer (genderSource === 'default'). Most Shopify catalogues are
 * gender-silent, so without this a womenswear brand lands almost entirely
 * UNISEX — this is the wizard's self-serve version of the demo importer's
 * per-brand regender map. Products with an inferred gender keep it.
 */
export class StartImportDto {
  @IsOptional()
  @IsEnum(GenderType)
  defaultGenderType?: GenderType;
}
