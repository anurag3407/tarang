/**
 * Domain types — email jobs (plan §7.14, §13).
 */

export type EmailJobState =
  | "PENDING"
  | "PROCESSING"
  | "SUBMITTED"
  | "DELIVERED"
  | "DELAYED"
  | "BOUNCED"
  | "COMPLAINED"
  | "SUPPRESSED"
  | "RETRY_WAIT"
  | "DEAD";

export type TemplateName =
  | "delegate-pass-confirmation"
  | "event-registration-confirmation"
  | "team-member-registration"
  | "payment-received-processing"
  | "payment-not-fulfilled"
  | "admin-invite"
  | "support-question-received"
  | "support-question-resolved"
  | "group-entry-notification";
