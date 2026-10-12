/**
 * Domain types — catalog, checkout, orders (plan §7.7–§7.11).
 */

export type OrderKind = "BASE_PASS" | "EVENT";

export type CheckoutState =
  | "PROVISIONING_PROVIDER"
  | "AWAITING_PAYMENT"
  | "FULFILLED"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED"
  | "PAYMENT_REVIEW";

export type PassProductRead = {
  id: string;
  slug: string;
  name: string;
  description: string;
  isBasePass: boolean;
  amountPaise: number;
  currency: string;
  salesState: string;
  validFrom: string;
  validUntil: string;
};

export type CheckoutResult = {
  localOrderId: string;
  publicOrderCode: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
  amountPaise: number;
  currency: string;
  expiresAt: string | null;
  status: CheckoutState | "CONFIRMED";
  /** True when the catalog price changed since the browser last saw it. */
  priceChanged?: boolean;
};

export type DelegatePassRead = {
  id: string;
  publicPassCode: string;
  state: "ACTIVE" | "REVOKED" | "REFUNDED" | "EXPIRED";
  activatedAt: string | null;
  expiresAt: string | null;
  productName: string;
};

export type RegistrationRead = {
  id: string;
  publicRegistrationCode: string;
  eventName: string;
  eventSlug: string;
  teamName: string | null;
  registrationMode: "INDIVIDUAL" | "TEAM";
  state: "CONFIRMED" | "CANCELLED" | "REFUNDED";
  confirmedAt: string | null;
  members: { displayName: string | null; role: string }[];
};

export type OrderRead = {
  id: string;
  publicOrderCode: string;
  kind: OrderKind;
  checkoutState: CheckoutState;
  amountPaise: number;
  currency: string;
  holdExpiresAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  description: string;
  paymentState: string | null;
  razorpayPaymentId: string | null;
};

export type TeamDraftRead = {
  id: string;
  eventName: string;
  teamName: string;
  status:
    | "DRAFT"
    | "READY"
    | "LOCKED_FOR_CHECKOUT"
    | "CONFIRMED"
    | "EXPIRED"
    | "CANCELLED";
  minTeamSize: number;
  maxTeamSize: number;
  members: {
    userId: string;
    displayName: string | null;
    role: "CAPTAIN" | "MEMBER";
    status: "INVITED" | "ACCEPTED" | "DECLINED" | "REMOVED";
    hasBasePass: boolean;
  }[];
  inviteCode: string | null;
};
