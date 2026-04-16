/**
 * The nine official provinces of South Africa. Used as the `@IsIn` whitelist
 * for Address validation. `country` defaults to "South Africa" — expand this
 * list when international shipping is considered.
 */
export const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
] as const;

export type SaProvince = (typeof SA_PROVINCES)[number];
