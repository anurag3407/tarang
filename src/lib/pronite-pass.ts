/**
 * TARANG sells one pass: the Pronite Pass. It is the product that used to be
 * the VIP Delegate pass (`vip-delegate-pass`, `is_base_pass = false`), so it
 * keeps that product's gate QR and confirmation email. The basic pass (BR
 * Card) is retired.
 *
 * Accepts API rows (`isBasePass`) and database rows (`is_base_pass`).
 */
export const PRONITE_PASS_SLUG = "vip-delegate-pass";

export function isPronitePassProduct(
  p:
    | {
        slug?: string | null;
        name?: string | null;
        isBasePass?: boolean | null;
        is_base_pass?: boolean | null;
      }
    | null
    | undefined
): boolean {
  if (!p) return false;
  if (p.slug === PRONITE_PASS_SLUG) return true;
  if (p.isBasePass === false || p.is_base_pass === false) return true;
  return /delegate|vip|all-access|pronite/i.test(p.name ?? "");
}
