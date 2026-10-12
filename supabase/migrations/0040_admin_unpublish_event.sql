-- 0040_admin_unpublish_event.sql
-- Atomic admin procedure to revert a published event back to draft status.

create or replace function admin_unpublish_event(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not has_permission('content.event.publish', null, v_event.festival_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update events
  set status = 'DRAFT'::content_status,
      sales_state = 'DRAFT'::sales_state,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_event_id
  returning * into v_event;

  perform write_audit('event.unpublish', 'event', p_event_id::text);
  return v_event;
end;
$$;

revoke all on function admin_unpublish_event from public, anon;
grant execute on function admin_unpublish_event to authenticated, service_role;
