/**
 * Converts a display name into a URL-safe slug.
 *
 * Transformations applied in order:
 * 1. Lowercase
 * 2. Strip characters that are not letters, numbers, or spaces
 * 3. Replace spaces with hyphens
 * 4. Collapse consecutive hyphens
 * 5. Remove leading and trailing hyphens
 *
 * Examples:
 *   "BOLD Streetwear"   → "bold-streetwear"
 *   "Khanyi's Skincare" → "khanyis-skincare"
 *   "THABO & Co."       → "thabo-co"
 *   "Lux  Essentials"   → "lux-essentials"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
