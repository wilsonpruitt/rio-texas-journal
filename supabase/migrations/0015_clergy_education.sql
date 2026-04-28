-- Add education_history to clergy (JSONB array of {institution, degree, raw}
-- entries parsed from Section I "ED:" lines). Same shape as status_history
-- so we get a consistent jsonb-on-clergy idiom; we can normalize to a
-- proper clergy_education table later if querying needs it.

alter table clergy
  add column if not exists education_history jsonb not null default '[]'::jsonb;

create index if not exists clergy_education_history_gin on clergy
  using gin (education_history);
