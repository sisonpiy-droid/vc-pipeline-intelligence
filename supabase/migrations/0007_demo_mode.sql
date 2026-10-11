-- 0007: demo mode. Clearly separated synthetic data that can exercise the whole workflow without ever touching real records.
--
--   investors.is_demo      true only for synthetic investors. Every real-data code path (the refresh planner, re-scoring, the
--                          dashboards in live mode) excludes them; demo mode shows ONLY them. The reset deletes only these rows.
--   investors.contact_email an address a draft can be opened to in the founder's own mail app. No real investor has one (the
--                          app never invents contact details); demo investors carry the test address.
--   runs.is_demo           simulated runs are kept apart from real ones, so they can never distort the real run history.
alter table investors add column is_demo boolean not null default false;
alter table investors add column contact_email text;
alter table runs add column is_demo boolean not null default false;

create index investors_demo_idx on investors (is_demo) where is_demo;
create index runs_demo_idx on runs (is_demo) where is_demo;

-- The refresh role must be able to see the flag (it selects investors column by column), so it can exclude demo rows.
grant select (is_demo) on investors to vc_refresh;
