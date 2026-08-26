-- Issues page support, 2026-08-26
-- client_errors already exists (app telemetry writes, staff read).
-- Owners can clear handled errors from the console.
drop policy if exists ce_del on client_errors;
create policy ce_del on client_errors for delete to authenticated using (is_owner());
create index if not exists client_errors_created on client_errors (created_at desc);
