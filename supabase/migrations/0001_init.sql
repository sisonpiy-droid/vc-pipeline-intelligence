-- 0001_init.sql — VC Fundraising Pipeline Intelligence
--
-- Column ownership on `investors` (the central design rule of this schema):
--
--   FOUNDER-OWNED   partner_name, partner_profile_url, last_contact_date,
--                   relationship_status, contact_history, personal_notes
--                   Set on first import (from the workbook) or by the founder.
--                   NEVER written by the import upsert after insert, NEVER by a refresh.
--
--   PROFILE         everything describing the investor itself (website, sectors, stage ...).
--                   Written by the importer only.
--
--   SIGNAL-DERIVED  last_signal_date, signal_summary, follow_up_score, recommended_action
--                   The ONLY columns the refresh pipeline may change. Enforced here, in the
--                   database, by the `vc_refresh` role (column-level UPDATE grant) — the
--                   TypeScript allowlist in src/lib/refresh/write.ts is a second layer.
--
-- Access model: the Next.js server connects with DATABASE_URL (a server-only secret). There is
-- no browser-side database client and no service-role key. RLS is enabled on every table with
-- no policy for anon/authenticated, so Supabase's auto-generated Data API exposes nothing.

-- ───────────────────────────── investors ─────────────────────────────
create table investors (
  id                  uuid primary key default gen_random_uuid(),

  -- identity
  entity_type         text not null check (entity_type in ('vc_firm', 'angel', 'network', 'accelerator')),
  entity_type_source  text not null default 'sheet' check (entity_type_source in ('sheet', 'heuristic')),
  name_key            text not null unique,                 -- normalised identity key (see normalize.ts)
  firm_name           text not null,                        -- display name; for an angel, the person's name
  aliases             text[] not null default '{}',         -- only aliases that appear in the source data
  role_title          text,                                 -- angels: e.g. "Co-founder, Zerodha"

  -- profile (import-owned)
  website_url         text,
  profile_url         text,
  investment_thesis   text,                                 -- VERIFIED thesis only; null until someone verifies it
  thesis_verified     boolean not null default false,
  fit_rationale       text,                                 -- workbook's initial rationale — unverified
  sectors             text[] not null default '{}',
  stage_preference    text,
  geography           text,
  notable_investments text[] not null default '{}',
  source_urls         text[] not null default '{}',
  source_ref          text,                                 -- provenance, e.g. 'VC Firms!row 12' or 'ANG-001'
  verification_status text not null default 'unverified'
                      check (verification_status in ('unverified', 'source_reviewed', 'verified')),
  verification_note   text,                                 -- the workbook's raw verification text
  data_flags          text[] not null default '{}',         -- missing / uncertain fields, see import.ts

  -- founder-owned (never touched by import-after-insert, never by refresh)
  partner_name        text,
  partner_profile_url text,
  last_contact_date   date,
  relationship_status text not null default 'not_contacted'
                      check (relationship_status in
                        ('not_contacted', 'contacted', 'in_conversation', 'awaiting_response', 'passed', 'committed')),
  contact_history     jsonb not null default '[]'::jsonb,
  personal_notes      text,

  -- signal-derived (the ONLY columns a refresh may write)
  last_signal_date    date,
  signal_summary      text,
  follow_up_score     smallint check (follow_up_score between 0 and 100),
  recommended_action  text check (recommended_action in
                        ('reach_out_now', 'prepare_targeted_outreach', 'wait_for_response', 'research_further', 'no_action')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index investors_score_idx on investors (follow_up_score desc nulls last);

-- updated_at tracks profile / founder edits. A signal refresh deliberately does NOT bump it:
-- a refresh leaves the row byte-identical outside the four signal columns, which the tests assert.
create function investors_touch() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action')
  then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
create trigger investors_touch before update on investors for each row execute function investors_touch();

-- ───────────────────────────── runs / run_items ─────────────────────────────
create table runs (
  id                   uuid primary key default gen_random_uuid(),
  trigger_type         text not null check (trigger_type in ('cron', 'manual')),
  status               text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at           timestamptz not null default now(),
  heartbeat_at         timestamptz not null default now(),   -- stale heartbeat => interrupted run, resumable
  completed_at         timestamptz,
  investors_total      int not null default 0,
  investors_processed  int not null default 0,
  sources_checked      int not null default 0,
  signals_discovered   int not null default 0,
  signals_accepted     int not null default 0,
  duplicates_removed   int not null default 0,
  records_updated      int not null default 0,
  error_count          int not null default 0,
  summary              text,
  error_details        jsonb not null default '[]'::jsonb
);
-- Overlap protection: at most one active run, enforced by the database rather than by app logic.
create unique index runs_single_active on runs ((true)) where status = 'running';

-- Durable work queue: one row per investor per run. This is what makes a 82-target refresh
-- resumable across serverless invocations (each invocation claims a few pending rows).
create table run_items (
  run_id       uuid not null references runs (id) on delete cascade,
  investor_id  uuid not null references investors (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts     int not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text,
  outcome      jsonb,         -- score breakdown, action explanation, accepted/rejected evidence, coverage
  primary key (run_id, investor_id)
);
create index run_items_pending_idx on run_items (run_id, status);

-- ───────────────────────────── signals ─────────────────────────────
create table signals (
  id                  uuid primary key default gen_random_uuid(),
  investor_id         uuid not null references investors (id) on delete cascade,
  run_id              uuid references runs (id) on delete set null,
  url                 text not null,
  canonical_url       text not null,
  headline            text not null,
  source_name         text,
  published_at        date,                                 -- null = date could not be established (never guessed)
  date_basis          text not null default 'unknown' check (date_basis in ('published', 'event', 'unknown')),
  retrieved_at        timestamptz not null default now(),
  signal_type         text check (signal_type in
                        ('portfolio_investment', 'article', 'interview_podcast', 'public_statement',
                         'event_appearance', 'fund_thesis_announcement', 'other')),
  evidence_excerpt    text,                                 -- verified to appear verbatim in the fetched source
  summary             text,
  relevance_explanation text,
  relevance_score     smallint check (relevance_score between 0 and 100),
  evidence_confidence text check (evidence_confidence in ('high', 'medium', 'low')),
  verification_status text not null check (verification_status in ('verified', 'needs_review', 'rejected')),
  rejection_reason    text,
  duplicate_of        uuid references signals (id) on delete set null,
  content_hash        text,                                 -- skip re-analysing unchanged content
  created_at          timestamptz not null default now(),
  unique (investor_id, canonical_url)
);
create index signals_investor_idx on signals (investor_id, published_at desc);
create index signals_feed_idx on signals (published_at desc) where verification_status = 'verified' and duplicate_of is null;

-- ───────────────────────────── source_coverage ─────────────────────────────
-- Latest retrieval state per (investor, source). A failed or empty retrieval is recorded
-- explicitly so the UI never confuses "search failed" with "investor is quiet".
create table source_coverage (
  investor_id    uuid not null references investors (id) on delete cascade,
  source         text not null,                             -- 'tavily_search' | 'official_site' | ...
  run_id         uuid references runs (id) on delete set null,
  checked_at     timestamptz not null default now(),
  status         text not null check (status in ('ok', 'empty', 'error', 'skipped')),
  result_count   int not null default 0,
  error_category text,                                      -- 'rate_limited' | 'timeout' | 'http_5xx' | 'malformed' | 'no_credentials' ...
  note           text,                                      -- coverage limitation, human readable
  primary key (investor_id, source)
);

-- ───────────────────────────── audit_logs ─────────────────────────────
create table audit_logs (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  run_id       uuid references runs (id) on delete set null,
  investor_id  uuid references investors (id) on delete set null,
  level        text not null default 'info' check (level in ('info', 'warn', 'error')),
  event        text not null,
  detail       jsonb not null default '{}'::jsonb          -- never contains notes or contact history
);
create index audit_logs_run_idx on audit_logs (run_id, at);

-- ───────────────────────────── least-privilege refresh role ─────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'vc_refresh') then
    create role vc_refresh nologin;
  end if;
end $$;
grant vc_refresh to current_user;   -- lets the server connection `SET LOCAL ROLE vc_refresh` inside a transaction

grant usage on schema public to vc_refresh;

-- Read: every investor column EXCEPT the two founder-private ones. The refresh cannot even read
-- personal_notes / contact_history. (Column list is generated; re-run this block when adding columns.)
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'investors'
     and column_name not in ('contact_history', 'personal_notes');
  execute format('grant select (%s) on investors to vc_refresh', cols);
end $$;

-- Write: the four signal-derived columns, and nothing else.
grant update (last_signal_date, signal_summary, follow_up_score, recommended_action) on investors to vc_refresh;

grant select, insert, update on runs, run_items, signals, source_coverage to vc_refresh;
grant select, insert on audit_logs to vc_refresh;
grant usage, select on all sequences in schema public to vc_refresh;

-- ───────────────────────────── row level security ─────────────────────────────
do $$ declare t text; begin
  foreach t in array array['investors', 'runs', 'run_items', 'signals', 'source_coverage', 'audit_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy refresh_rw on %I for all to vc_refresh using (true) with check (true)', t);
  end loop;
end $$;

-- Supabase auto-grants new tables to its Data API roles. Revoke (RLS would block them anyway;
-- this is belt and braces). No-op on plain Postgres where those roles do not exist.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
end $$;
