/**
 * Domain types — payments (plan §7.10).
 *
 * Refunds are not automated on this platform: a payment left in
 * REFUND_REQUIRED / REVIEW is a manual obligation the organizers settle
 * offline. There is therefore no refund state machine in the app layer.
 */

export type PaymentDisposition =
  | "UNAPPLIED"
  | "APPLIED"
  | "REFUND_REQUIRED"
  | "REFUNDED"
  | "REVIEW";

export type PaymentRead = {
  id: string;
  razorpayPaymentId: string;
  amountPaise: number;
  currency: string;
  providerStatus: string;
  disposition: PaymentDisposition;
  refundedPaise: number;
};
