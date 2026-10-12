-- Multiple startups, each with its own scoring rubric. The investor list and the collected evidence (signals) are shared;
-- what is per startup is the rubric, the Gemini judgement of each stored signal against THAT startup, and the resulting scores.
-- Nothing here touches `investors`, `signals` or the founder's own scores: the main workspace is unchanged.
create table startups (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  pitch         text not null,
  sector        text not null,
  stage         text not null check (stage in ('pre_seed', 'seed', 'series_a', 'series_b_plus')),
  geography     text not null default 'Global',
  round_size    text,
  ask           text,
  rubric        jsonb not null,
  rubric_source text not null check (rubric_source in ('gemini', 'default', 'edited')),
  rubric_note   text,                                   -- why the default rubric was used, when it was
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per workflow step per startup: what ran, with what result. A step that has not run is 'pending', never "done".
create table startup_steps (
  startup_id  uuid not null references startups (id) on delete cascade,
  step        text not null check (step in ('profile', 'rubric', 'candidates', 'evidence', 'judge', 'score')),
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'partial', 'failed')),
  detail      text,
  stats       jsonb not null default '{}'::jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  primary key (startup_id, step)
);

-- Gemini's reading of a stored signal against one startup (relevance, how close the topic is). Cached, so re-scoring is free.
create table startup_signal_reviews (
  startup_id   uuid not null references startups (id) on delete cascade,
  signal_id    uuid not null references signals (id) on delete cascade,
  relevance    smallint not null check (relevance between 0 and 100),
  sector_match text not null check (sector_match in ('logistics', 'b2b_software', 'seed_generalist', 'adjacent', 'unrelated')),
  note         text,
  reviewed_at  timestamptz not null default now(),
  primary key (startup_id, signal_id)
);

create table startup_scores (
  startup_id     uuid not null references startups (id) on delete cascade,
  investor_id    uuid not null references investors (id) on delete cascade,
  score          smallint not null check (score between 0 and 100),
  action         text not null,
  explanation    text,
  breakdown      jsonb,
  capped_by      jsonb not null default '[]'::jsonb,
  lead_signal_id uuid,
  evidence_count int not null default 0,                -- verified signals in the last 30 days that were considered
  coverage       text not null default 'complete' check (coverage in ('complete', 'partial')),
  note           text,                                  -- e.g. "evidence not yet judged for this startup"
  scored_at      timestamptz not null default now(),
  primary key (startup_id, investor_id)
);
create index startup_scores_rank_idx on startup_scores (startup_id, score desc);

-- Same posture as every other table: RLS on with no policy, nothing granted to the public roles or the refresh role.
do $$ declare t text; r text; begin
  foreach t in array array['startups', 'startup_steps', 'startup_signal_reviews', 'startup_scores'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'vc_refresh'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on %I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;
