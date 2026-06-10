const VAT_RATE = 0.15;

/**
 * YIIVA prices are VAT-inclusive (SA retail convention). This returns the VAT
 * portion already contained in a VAT-inclusive amount — for display only; it is
 * NOT added on top of the total. See maya CK-2 / D6.
 */
export function vatIncludedPortion(totalInclusiveInCents: number): number {
  return Math.round(
    totalInclusiveInCents - totalInclusiveInCents / (1 + VAT_RATE),
  );
}
