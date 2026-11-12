-- Apply once in Supabase SQL Editor BEFORE deploying the backend.
-- No old games are rewritten. Event inserts and game writes share a transaction.
begin;

alter table public.game_runs add column if not exists audit_action jsonb;

create table if not exists public.game_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.game_runs(id) on delete cascade,
  action text not null check (action in ('start', 'checkpoint', 'move', 'undo', 'finish', 'mutation')),
  direction text check (direction in ('up', 'down', 'left', 'right')),
  engine_version text,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists game_run_events_run_order on public.game_run_events(run_id, id);

-- Only the server can read the journal. Writes go through the trigger owner.
alter table public.game_run_events enable row level security;
revoke all on public.game_run_events from public, anon, authenticated, service_role;
grant select on public.game_run_events to service_role;

create or replace function public.ffg_game_audit_snapshot(r public.game_runs)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'seed', r.seed::text,
    'state', r.state, 'rng_index', r.rng_index, 'moves', r.moves,
    'current_score', r.current_score, 'status', r.status,
    'undo_used_count', r.undo_used_count, 'undo_available', r.undo_available,
    'finished_reason', r.finished_reason, 'finished_at', r.finished_at,
    'prev_state', r.prev_state, 'prev_rng_index', r.prev_rng_index,
    'prev_moves', r.prev_moves, 'prev_current_score', r.prev_current_score,
    'prev_status', r.prev_status, 'prev_finished_reason', r.prev_finished_reason,
    'prev_finished_at', r.prev_finished_at
  );
$$;
revoke all on function public.ffg_game_audit_snapshot(public.game_runs) from public, anon, authenticated;

create or replace function public.ffg_record_game_run_event()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  before_data jsonb;
  after_data jsonb;
  event_action text;
  details jsonb := '{}'::jsonb;
begin
  after_data := public.ffg_game_audit_snapshot(new);
  if tg_op = 'INSERT' then
    event_action := case when coalesce(new.moves, 0) = 0 then 'start' else 'checkpoint' end;
    if new.audit_action->>'type' = event_action then details := new.audit_action; end if;
  else
    before_data := public.ffg_game_audit_snapshot(old);
    if before_data = after_data then return new; end if;

    -- Existing games begin with a labelled partial checkpoint, never a fake start.
    if not exists (select 1 from public.game_run_events where run_id = new.id) then
      insert into public.game_run_events(run_id, action, after_snapshot, metadata)
      values (new.id, 'checkpoint', before_data, '{"reason":"logging_enabled_mid_run"}'::jsonb);
    end if;
    if coalesce(new.undo_used_count, 0) > coalesce(old.undo_used_count, 0) then
      event_action := 'undo';
    elsif new.moves = old.moves + 1 then
      event_action := 'move';
    elsif new.status = 'finished' then
      event_action := 'finish';
    else
      event_action := 'mutation';
    end if;
    -- Prevent a weekly finalizer from reusing the previous move's metadata.
    if new.audit_action is distinct from old.audit_action and new.audit_action->>'type' = event_action then
      details := new.audit_action;
    end if;
  end if;

  insert into public.game_run_events(run_id, action, direction, engine_version, before_snapshot, after_snapshot, metadata)
  values (new.id, event_action,
    case when event_action = 'move' then details->>'dir' else null end,
    details->>'engine_version', before_data, after_data, details);
  return new;
end;
$$;
revoke all on function public.ffg_record_game_run_event() from public, anon, authenticated;

drop trigger if exists ffg_game_run_audit on public.game_runs;
create trigger ffg_game_run_audit after insert or update on public.game_runs
for each row execute function public.ffg_record_game_run_event();

notify pgrst, 'reload schema';
commit;
