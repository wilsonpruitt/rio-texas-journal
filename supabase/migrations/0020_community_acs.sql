-- Phase 3: cached Census ACS 5-year neighborhood profile, keyed by ZIP (ZCTA).
-- One row per (zip, acs_year); churches join via church.zip. Pulled by
-- scripts/enrich-census.ts, never per page load.

create table if not exists community_acs (
  zip                     text not null,
  acs_year                int  not null,
  total_pop               int,
  median_age              numeric,
  median_household_income int,
  pct_hispanic            numeric,
  pct_black               numeric,
  pct_white               numeric,
  pct_asian               numeric,
  pct_under18             numeric,
  pct_over65              numeric,
  pct_family_households   numeric,
  poverty_rate            numeric,
  unemployment_rate       numeric,
  pulled_at               timestamptz not null default now(),
  primary key (zip, acs_year)
);

alter table public.community_acs enable row level security;
create policy public_read_community_acs on public.community_acs
  for select to anon, authenticated using (true);
