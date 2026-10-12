/**
 * Money helpers (plan §2.1.5).
 *
 * Every money amount is an integer number of paise. Postgres stores them as
 * `bigint`; PostgREST serializes bigint as strings, so we accept both and
 * normalize to `number` paise (safe: amounts are far below 2^53).
 *
 * Never use floating point or rupee decimals in application logic.
 */

export type Paise = number;

/** Normalize a Postgres bigint (string) or number into integer paise. */
export function toPaise(value: string | number | bigint | null | undefined): Paise {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid paise amount: ${String(value)}`);
  }
  return n;
}

/** Format paise as a rupee display string: 20000 -> "₹200". */
export function formatPaise(paise: Paise): string {
  if (paise === 0) return "FREE";
  const rupees = paise / 100;
  const formatted = Number.isInteger(rupees)
    ? rupees.toLocaleString("en-IN")
    : rupees.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `₹${formatted}`;
}

/** Convert a validated rupee input (from admin forms) to integer paise. */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  const paise = Math.round(rupees * 100);
  if (!Number.isInteger(paise)) {
    throw new Error(`Rupee amount has sub-paise precision: ${rupees}`);
  }
  return paise;
}

/** Multiply unit price by quantity, staying in integer paise. */
export function multiplyPaise(unitPaise: Paise, quantity: number): Paise {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  return unitPaise * quantity;
}
