-- ============================================================
-- TARANG 2026 — Database Cleanup Script
-- Removes all user-generated data. Preserves system config.
-- Run via: psql $SUPABASE_DB_SESSION_URL -f scripts/clean-db.sql
-- ============================================================

BEGIN;

-- Disable triggers temporarily for clean cascade
SET session_replication_role = 'replica';

-- 1. Delete scan/admission data
DELETE FROM admissions;
DELETE FROM scan_attempts;
DELETE FROM gate_assignments;
DELETE FROM scanner_devices;

-- 2. Delete QR credentials
DELETE FROM qr_credentials;

-- 3. Delete export/sheets sync data
DELETE FROM sheets_sync_items;
DELETE FROM sheets_sync_state;
DELETE FROM export_jobs;

-- 4. Delete email data
DELETE FROM email_events;
DELETE FROM email_jobs;
DELETE FROM email_suppressions;

-- 5. Delete outbox jobs
DELETE FROM outbox_jobs;

-- 6. Delete webhook events
DELETE FROM webhook_events;

-- 7. Delete refund data
DELETE FROM refund_allocations;
DELETE FROM refunds;

-- 8. Delete payment data
DELETE FROM payment_applications;
DELETE FROM payments;
DELETE FROM razorpay_orders;

-- 9. Delete registration data
DELETE FROM registration_members;
DELETE FROM registrations;

-- 10. Delete checkout/inventory holds
DELETE FROM event_participant_claims;
DELETE FROM capacity_holds;

-- 11. Delete order data
DELETE FROM order_participants;
DELETE FROM order_lines;
DELETE FROM orders;

-- 12. Delete idempotency records
DELETE FROM api_idempotency;

-- 13. Delete delegate passes
DELETE FROM delegate_passes;

-- 14. Delete team drafts
DELETE FROM team_draft_members;
DELETE FROM team_drafts;

-- 15. Delete support questions
DELETE FROM support_questions;

-- 16. Delete audit logs
DELETE FROM audit_logs;

-- 17. Delete staff assignments EXCEPT superadmin
-- Keep staff_assignments where the role is_superadmin = true
DELETE FROM staff_event_scopes
WHERE staff_assignment_id IN (
  SELECT sa.id FROM staff_assignments sa
  JOIN roles r ON r.id = sa.role_id
  WHERE r.is_superadmin = false
);

DELETE FROM staff_assignments
WHERE role_id NOT IN (
  SELECT id FROM roles WHERE is_superadmin = true
);

-- 18. Delete profiles EXCEPT superadmin user
DELETE FROM profiles
WHERE user_id NOT IN (
  SELECT sa.user_id FROM staff_assignments sa
  JOIN roles r ON r.id = sa.role_id
  WHERE r.is_superadmin = true
);

-- 19. Delete auth.users EXCEPT superadmin user
-- Note: This requires service_role or postgres superuser access
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT sa.user_id FROM staff_assignments sa
  JOIN roles r ON r.id = sa.role_id
  WHERE r.is_superadmin = true
);

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Reset event inventory held/confirmed counts to zero
UPDATE event_inventory
SET held_units = 0,
    confirmed_units = 0,
    version = version + 1,
    updated_at = NOW();

COMMIT;

-- Verify cleanup
SELECT 'auth.users' AS table_name, COUNT(*) AS remaining FROM auth.users
UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL SELECT 'delegate_passes', COUNT(*) FROM delegate_passes
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'registrations', COUNT(*) FROM registrations
UNION ALL SELECT 'staff_assignments', COUNT(*) FROM staff_assignments
UNION ALL SELECT 'festivals', COUNT(*) FROM festivals
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'pass_products', COUNT(*) FROM pass_products;
