-- Runs-only leaderboard schema (duplicate usernames allowed, no device identity).
create extension if not exists pgcrypto;

create table if not exists public.leaderboard_profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  instagram_username text null,
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_profiles_created_at_desc_idx
  on public.leaderboard_profiles (created_at desc);

create table if not exists public.leaderboard_runs (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.leaderboard_profiles(id) on delete cascade,
  score integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_runs_score_created_id_idx
  on public.leaderboard_runs (score desc, created_at asc, id asc);

create index if not exists leaderboard_runs_profile_created_desc_idx
  on public.leaderboard_runs (profile_id, created_at desc);

alter table public.leaderboard_profiles enable row level security;
alter table public.leaderboard_runs enable row level security;

-- No anon/auth policies by design; writes/reads happen via Edge Functions.

create or replace function public.leaderboard_run_rank(p_run_id bigint)
returns bigint
language sql
stable
as $$
  with target as (
    select id, score, created_at
    from public.leaderboard_runs
    where id = p_run_id
  )
  select case
    when exists(select 1 from target) then (
      select 1 + count(*)::bigint
      from public.leaderboard_runs r
      cross join target t
      where
        r.score > t.score
        or (r.score = t.score and r.created_at < t.created_at)
        or (r.score = t.score and r.created_at = t.created_at and r.id < t.id)
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

grant execute on function public.leaderboard_run_rank(bigint) to service_role;
grant execute on function public.leaderboard_runs_page(integer, integer) to service_role;
