-- 0004: second-pass evidence review, score history, provider telemetry, and re-scoring without a search.

-- ── Second-pass review of verified evidence ──
-- A second, narrower Gemini question per verified signal: does the excerpt show THIS firm acting, and how close is
-- the topic to the founder's market? Stored next to the evidence so the score can use it and the UI can explain it.
alter table signals add column sector_match     text check (sector_match in ('logistics', 'b2b_software', 'seed_generalist', 'adjacent', 'unrelated'));
alter table signals add column firm_acting      boolean;         -- null = not reviewed
alter table signals add column display_headline text;            -- written from the excerpt only when the page title is unusable or names someone else
alter table signals add column review_note      text;
alter table signals add column reviewed_at      timestamptz;

-- ── Score history ──
-- One row each time an investor is scored (a refresh or a search-free re-score). The dashboard reads the latest row
-- for the explanation / breakdown / angle, so a re-score can never leave a stale breakdown next to a new number.
create table score_history (
  id             bigint generated always as identity primary key,
  investor_id    uuid not null references investors (id) on delete cascade,
  at             timestamptz not null default now(),
  source         text not null check (source in ('refresh', 'rescore')),
  run_id         uuid references runs (id) on delete set null,
  score          smallint not null check (score between 0 and 100),
  action         text not null,
  explanation    text,
  breakdown      jsonb,
  lead_signal_id uuid,                       -- the signal the score was computed from (no FK: it may later be deleted)
  capped_by      jsonb not null default '[]'::jsonb,
  angle          text
);
create index score_history_investor_idx on score_history (investor_id, at desc);

insert into score_history (investor_id, at, source, run_id, score, action, explanation, breakdown, lead_signal_id, angle)
select ri.investor_id, coalesce(ri.finished_at, now()), 'refresh', ri.run_id, (ri.outcome->>'score')::int, coalesce(ri.outcome->>'action', 'no_action'),
       ri.outcome->>'explanation', ri.outcome->'breakdown', nullif(ri.outcome->>'lead_signal_id', '')::uuid, ri.outcome->>'angle'
  from run_items ri
 where ri.status = 'done' and ri.outcome->>'score' is not null;

-- ── Provider telemetry ──
-- Latency and outcome of every external call, so the run page can show provider health from measurements.
create table provider_calls (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  run_id    uuid references runs (id) on delete set null,
  provider  text not null,                   -- 'tavily' | 'gemini' | 'page_fetch'
  ok        boolean not null,
  category  text,                            -- error category when not ok
  ms        int not null
);
create index provider_calls_at_idx on provider_calls (at desc);

grant select, insert, update on score_history to vc_refresh;
grant select, insert on provider_calls to vc_refresh;
grant usage, select on all sequences in schema public to vc_refresh;

do $$ declare t text; begin
  foreach t in array array['score_history', 'provider_calls'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy refresh_rw on %I for all to vc_refresh using (true) with check (true)', t);
  end loop;
end $$;

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on score_history, provider_calls from %I', r);
    end if;
  end loop;
end $$;
