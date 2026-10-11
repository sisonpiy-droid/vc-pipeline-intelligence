-- 0005: portfolio check. What an investor already backs, read from its own portfolio page: shows whether it really
-- invests in logistics (thesis evidence) and whether a company it backs could be a direct competitor to the founder.
-- Informational: it does not change a score. Written by the refresh role like the other evidence tables.
create table portfolio_companies (
  investor_id        uuid not null references investors (id) on delete cascade,
  company            text not null,
  description        text,
  logistics_related  boolean not null default false,
  competitor_risk    text not null default 'none' check (competitor_risk in ('direct', 'adjacent', 'none')),
  evidence           text,                       -- verbatim from the page; required for any logistics claim
  source_url         text not null,
  checked_at         timestamptz not null default now(),
  primary key (investor_id, company)
);
create index portfolio_companies_logistics_idx on portfolio_companies (investor_id) where logistics_related;

grant select, insert, update, delete on portfolio_companies to vc_refresh;

alter table portfolio_companies enable row level security;
create policy refresh_rw on portfolio_companies for all to vc_refresh using (true) with check (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on portfolio_companies from %I', r);
    end if;
  end loop;
end $$;
