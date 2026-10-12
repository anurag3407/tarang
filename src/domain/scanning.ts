/**
 * Domain types — QR credentials and scanning (plan §7.15, §14).
 */

export type ScanOutcome =
  | "accepted"
  | "accepted_reentry"
  | "provisional_offline"
  | "duplicate"
  | "cooldown"
  | "revoked"
  | "refunded"
  | "expired"
  | "wrong_event"
  | "wrong_gate"
  | "not_yet_valid"
  | "invalid_signature"
  | "unknown_credential"
  | "manual_override";

export type ScanResult = {
  outcome: ScanOutcome;
  reasonCode: string | null;
  /** Limited display context — never broad participant data. */
  display: {
    maskedName: string | null;
    passClass: string | null;
    eventName: string | null;
  } | null;
  recentScans: { gateName: string; at: string; outcome: string }[];
};

export type GateRead = {
  id: string;
  name: string;
  gateType: "GENERAL" | "EVENT" | "PRO_SHOW";
  admissionPolicy:
    | "ONE_PER_DAY"
    | "ONE_PER_EVENT"
    | "REENTRY_ALLOWED"
    | "HISTORY_ONLY";
  offlinePolicy: "FAIL_CLOSED" | "PROVISIONAL_GENERAL";
};

/**
 * QR credential payload (plan §14.1). No PII — only a random credential id,
 * scope metadata, and validity window.
 */
export type QrPayload = {
  v: number;
  jti: string;
  fest: string;
  pass: string;
  entv: number;
  nbf: number;
  exp: number;
  class: string;
};
