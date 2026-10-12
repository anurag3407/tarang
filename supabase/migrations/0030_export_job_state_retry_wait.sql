-- 0030_export_job_state_retry_wait.sql
-- Add RETRY_WAIT to export_job_state enum.
-- In PostgreSQL, new enum values must be committed in their own transaction
-- before they can be used in queries, indexes, or plpgsql functions.

alter type export_job_state add value if not exists 'RETRY_WAIT';
