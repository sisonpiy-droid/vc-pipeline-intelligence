-- 0003: free-tier credit accounting, run planning, official-feed dates, new-capital flag.

-- Runs now record how many metered search calls they made, whether LinkedIn was searched, how many investors
-- were deliberately not searched (and why), so the monthly Tavily budget can be enforced from the database.
alter table runs add column search_calls     int     not null default 0;
alter table runs add column include_linkedin boolean not null default false;
alter table runs add column skipped          int     not null default 0;
alter table runs add column plan             jsonb   not null default '{}'::jsonb;

-- Runs made before this migration did one search per investor processed.
update runs set search_calls = investors_processed;

-- A signal's date can also come from an official site's own RSS/Atom feed.
alter table signals drop constraint if exists signals_date_source_check;
alter table signals add constraint signals_date_source_check
  check (date_source in ('page', 'search_estimate', 'post_id', 'feed'));

-- "A fund just closed / raised its cheque ceiling": capital is available to deploy.
alter table signals add column new_capital boolean not null default false;
