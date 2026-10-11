-- 0002: a signal's date can now also come from a LinkedIn post ID (a time-ordered ID that embeds a timestamp).
alter table signals drop constraint if exists signals_date_source_check;
alter table signals add constraint signals_date_source_check
  check (date_source in ('page', 'search_estimate', 'post_id'));
