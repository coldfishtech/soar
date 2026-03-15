-- Phase 1 anti-cheat hardening: ownership, one-time run sessions, metadata, and persistent rate limits.

alter table public.leaderboard_profiles
  add column if not exists auth_user_id uuid;

update public.leaderboard_profiles
set auth_user_id = gen_random_uuid()
where auth_user_id is null;

alter table public.leaderboard_profiles
  alter column auth_user_id set not null;

create index if not exists leaderboard_profiles_auth_created_desc_idx
  on public.leaderboard_profiles (auth_user_id, created_at desc);

alter table public.leaderboard_runs
  add column if not exists duration_ms integer,
  add column if not exists build_version text,
  add column if not exists ip_hash text,
  add column if not exists user_agent text,
  add column if not exists auth_user_id uuid,
  add column if not exists is_suspicious boolean default false,
  add column if not exists suspicious_reasons jsonb default '[]'::jsonb;

update public.leaderboard_runs r
set auth_user_id = p.auth_user_id
from public.leaderboard_profiles p
where r.profile_id = p.id
  and r.auth_user_id is null;

update public.leaderboard_runs
set duration_ms = 0
where duration_ms is null;

update public.leaderboard_runs
set build_version = 'legacy'
where build_version is null;

update public.leaderboard_runs
set ip_hash = 'legacy'
where ip_hash is null;

update public.leaderboard_runs
set user_agent = 'legacy'
where user_agent is null;

update public.leaderboard_runs
set is_suspicious = false
where is_suspicious is null;

update public.leaderboard_runs
set suspicious_reasons = '[]'::jsonb
where suspicious_reasons is null;

alter table public.leaderboard_runs
  alter column duration_ms set not null,
  alter column build_version set not null,
  alter column ip_hash set not null,
  alter column user_agent set not null,
  alter column auth_user_id set not null,
  alter column is_suspicious set not null,
  alter column suspicious_reasons set not null;

alter table public.leaderboard_runs
  add constraint leaderboard_runs_duration_non_negative_chk
  check (duration_ms >= 0);

create index if not exists leaderboard_runs_public_rank_idx
  on public.leaderboard_runs (is_suspicious, score desc, created_at asc, id asc);

create index if not exists leaderboard_runs_auth_created_desc_idx
  on public.leaderboard_runs (auth_user_id, created_at desc);

create table if not exists public.leaderboard_run_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.leaderboard_profiles(id) on delete cascade,
  auth_user_id uuid not null,
  session_token_hash text not null,
  build_version text not null,
  ip_hash text not null,
  user_agent text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null
);

create index if not exists leaderboard_run_sessions_auth_started_desc_idx
  on public.leaderboard_run_sessions (auth_user_id, started_at desc);

create index if not exists leaderboard_run_sessions_profile_started_desc_idx
  on public.leaderboard_run_sessions (profile_id, started_at desc);

create index if not exists leaderboard_run_sessions_expires_at_idx
  on public.leaderboard_run_sessions (expires_at);

alter table public.leaderboard_run_sessions enable row level security;

create table if not exists public.rate_limit_counters (
  key text not null,
  bucket_start timestamptz not null,
  count integer not null default 0,
  primary key (key, bucket_start)
);

create index if not exists rate_limit_counters_bucket_start_idx
  on public.rate_limit_counters (bucket_start);

alter table public.rate_limit_counters enable row level security;

create or replace function public.consume_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    return false;
  end if;
  if p_max <= 0 or p_window_seconds <= 0 then
    return false;
  end if;

  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (key, bucket_start, count)
  values (p_key, v_bucket, 1)
  on conflict (key, bucket_start)
  do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

create or replace function public.cleanup_rate_limit_counters(
  p_max_age interval default interval '48 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.rate_limit_counters
  where bucket_start < now() - p_max_age;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.leaderboard_run_rank(p_run_id bigint)
returns bigint
language sql
stable
as $$
  with target as (
    select id, score, created_at, is_suspicious
    from public.leaderboard_runs
    where id = p_run_id
  )
  select case
    when exists(select 1 from target where is_suspicious = false) then (
      select 1 + count(*)::bigint
      from public.leaderboard_runs r
      cross join target t
      where
        r.is_suspicious = false
        and (
          r.score > t.score
          or (r.score = t.score and r.created_at < t.created_at)
          or (r.score = t.score and r.created_at = t.created_at and r.id < t.id)
        )
    )
    else null
  end;
$$;

create or replace function public.leaderboard_runs_page(p_limit integer default 100, p_offset integer default 0)
returns table (
  rank bigint,
  run_id bigint,
  username text,
  score integer,
  created_at timestamptz
)
language sql
stable
as $$
  with ranked as (
    select
      row_number() over (order by r.score desc, r.created_at asc, r.id asc)::bigint as rank,
      r.id as run_id,
      p.username,
      r.score,
      r.created_at
    from public.leaderboard_runs r
    join public.leaderboard_profiles p
      on p.id = r.profile_id
    where r.is_suspicious = false
  )
  select
    ranked.rank,
    ranked.run_id,
    ranked.username,
    ranked.score,
    ranked.created_at
  from ranked
  order by ranked.rank
  limit greatest(1, least(coalesce(p_limit, 100), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.cleanup_rate_limit_counters(interval) to service_role;
grant execute on function public.leaderboard_run_rank(bigint) to service_role;
grant execute on function public.leaderboard_runs_page(integer, integer) to service_role;
