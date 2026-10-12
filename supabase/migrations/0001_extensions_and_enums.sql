-- 0001: extensions and enums (plan §7.1, §11.2)
-- Schema authority: Supabase CLI migrations.

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists citext;        -- case-insensitive emails/codes

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

create type festival_status as enum ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');
create type profile_status as enum ('ACTIVE', 'SUSPENDED', 'ANONYMIZED');
create type staff_assignment_status as enum ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
create type content_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type schedule_status as enum ('DRAFT', 'PUBLISHED', 'CANCELLED');
create type notice_status as enum ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
create type notice_tag as enum ('URGENT', 'UPDATE', 'INFO', 'REGISTRATION');
create type registration_mode as enum ('INDIVIDUAL', 'TEAM');
create type capacity_basis as enum ('TEAM', 'PARTICIPANT');
create type price_basis as enum ('REGISTRATION', 'PARTICIPANT');
create type sales_state as enum ('DRAFT', 'SCHEDULED', 'OPEN', 'PAUSED', 'SOLD_OUT', 'CLOSED', 'CANCELLED');
create type support_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'SPAM');
create type team_draft_status as enum ('DRAFT', 'READY', 'LOCKED_FOR_CHECKOUT', 'CONFIRMED', 'EXPIRED', 'CANCELLED');
create type team_member_role as enum ('CAPTAIN', 'MEMBER');
create type team_member_status as enum ('INVITED', 'ACCEPTED', 'DECLINED', 'REMOVED');
create type order_kind as enum ('BASE_PASS', 'EVENT');
create type checkout_state as enum ('PROVISIONING_PROVIDER', 'AWAITING_PAYMENT', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'PAYMENT_REVIEW');
create type order_line_kind as enum ('PASS', 'EVENT');
create type participant_role as enum ('CAPTAIN', 'MEMBER', 'INDIVIDUAL');
create type hold_state as enum ('ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED');
create type claim_state as enum ('HELD', 'CONFIRMED', 'RELEASED');
create type payment_disposition as enum ('UNAPPLIED', 'APPLIED', 'REFUND_REQUIRED', 'REFUNDED', 'REVIEW');
create type pass_state as enum ('ACTIVE', 'REVOKED', 'REFUNDED', 'EXPIRED');
create type registration_state as enum ('CONFIRMED', 'CANCELLED', 'REFUNDED');
create type refund_state as enum ('REQUESTED', 'APPROVED', 'SUBMITTING', 'PENDING', 'PROCESSED', 'FAILED', 'REVIEW');
create type webhook_provider as enum ('RAZORPAY', 'RESEND');
create type webhook_processing_state as enum ('RECEIVED', 'PROCESSING', 'PROCESSED', 'RETRY', 'DEAD');
create type outbox_job_state as enum ('PENDING', 'DISPATCHED', 'PROCESSING', 'RETRY_WAIT', 'DONE', 'DEAD');
create type email_job_state as enum ('PENDING', 'PROCESSING', 'SUBMITTED', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'RETRY_WAIT', 'DEAD');
create type qr_credential_state as enum ('ACTIVE', 'REVOKED', 'REPLACED', 'EXPIRED');
create type gate_type as enum ('GENERAL', 'EVENT', 'PRO_SHOW');
create type admission_policy as enum ('ONE_PER_DAY', 'ONE_PER_EVENT', 'REENTRY_ALLOWED', 'HISTORY_ONLY');
create type offline_policy as enum ('FAIL_CLOSED', 'PROVISIONAL_GENERAL');
create type scanner_device_state as enum ('PENDING', 'ACTIVE', 'REVOKED');
create type export_job_state as enum ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');
create type idempotency_state as enum ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
create type audit_actor_type as enum ('USER', 'SERVICE', 'DEVICE', 'SYSTEM');
create type audit_result as enum ('SUCCESS', 'DENIED', 'FAILED');
