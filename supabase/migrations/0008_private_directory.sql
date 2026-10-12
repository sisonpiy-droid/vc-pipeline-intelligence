-- A private contact directory (cold lists imported from the founder's own spreadsheets). It is deliberately separate from
-- `investors`: no page, API route, export or refresh job reads it, and the restricted refresh role has no grant on it. It is
-- not part of the public product and nothing here is shown anywhere until the founder decides otherwise.
create table investor_directory (
  id            uuid primary key default gen_random_uuid(),
  dedup_key     text not null unique,        -- e:<email> | l:<linkedin handle> | n:<name>|<organisation>
  kind          text not null check (kind in ('vc', 'angel', 'family_office', 'network', 'accelerator', 'other')),
  name          text,
  organisation  text,
  designation   text,
  email         text,
  email2        text,
  phone         text,
  linkedin      text,
  website       text,
  location      text,
  investor_type text,
  stage         text,
  sectors       text,
  thesis        text,
  status        text,                        -- the status written in the source sheet, as found
  remarks       text,
  extra         jsonb not null default '{}',
  sources       text[] not null default '{}', -- "<file> / <sheet>", every place the row was found
  imported_at   timestamptz not null default now()
);
create index investor_directory_kind_idx on investor_directory (kind);
create index investor_directory_org_idx on investor_directory (lower(organisation));

-- RLS on with no policy: only the table owner (the app's server-side connection) can read it.
alter table investor_directory enable row level security;

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'vc_refresh'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on investor_directory from %I', r);
    end if;
  end loop;
end $$;
