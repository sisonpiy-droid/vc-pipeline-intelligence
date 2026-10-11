-- 0006: provisional evidence. A candidate judged from the search snippet ONLY because its page could not be fetched
-- (a timeout, a 5xx: a transient failure) is stored with capped confidence. It is marked provisional so that the next
-- refresh fetches the page again and judges it properly, instead of leaving a temporary outage as a permanent penalty.
alter table signals add column provisional boolean not null default false;
create index signals_provisional_idx on signals (investor_id) where provisional;
