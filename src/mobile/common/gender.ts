import { GenderType } from '@prisma/client';

/** Lowercased gender values the mobile client sends / receives. */
export type GenderParam = 'women' | 'men' | 'unisex';

const PARAM_TO_ENUM: Record<GenderParam, GenderType> = {
  women: GenderType.WOMEN,
  men: GenderType.MEN,
  unisex: GenderType.UNISEX,
};

export function genderEnumToParam(g: GenderType | null): GenderParam | null {
  switch (g) {
    case GenderType.WOMEN:
      return 'women';
    case GenderType.MEN:
      return 'men';
    case GenderType.UNISEX:
      return 'unisex';
    default:
      return null;
  }
}

/**
 * Which DB enum values a requested gender param matches. UNISEX products surface
 * in BOTH the women and men feeds; a `unisex` request is exact.
 */
export function genderFilterValues(param: GenderParam): GenderType[] {
  if (param === 'unisex') return [GenderType.UNISEX];
  return [PARAM_TO_ENUM[param], GenderType.UNISEX];
}

/** The single EXACT enum value for a gender param (no UNISEX widening). */
export function genderExactValue(param: GenderParam): GenderType {
  return PARAM_TO_ENUM[param];
}
