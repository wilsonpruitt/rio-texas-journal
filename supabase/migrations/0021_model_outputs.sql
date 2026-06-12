-- Phase 4: model outputs, computed offline by scripts/build-models.ts and read by the
-- site (never computed per page load). All public-read like the rest of the dataset.

-- Per-church trend projections (membership, attendance, ...) -------------------
create table if not exists church_projection (
  church_id    uuid not null references church(id) on delete cascade,
  field_code   text not null,
  method       text not null,            -- 'ols'
  base_year    int  not null,            -- last observed year used
  base_value   numeric,
  slope        numeric,                  -- per-year change
  r2           numeric,
  horizon_year int  not null,
  projected    numeric,
  lo           numeric,                  -- ±1 residual-sd band
  hi           numeric,
  primary key (church_id, field_code, horizon_year)
);

-- Per-church closure / vitality risk -----------------------------------------
create table if not exists church_vitality (
  church_id    uuid primary key references church(id) on delete cascade,
  as_of_year   int  not null,
  risk_score   numeric not null,         -- 0..100, higher = more at risk
  risk_tier    text not null,            -- low | moderate | elevated | high
  prob_decline numeric,                  -- logistic probability of ceasing to report
  factors      jsonb,                    -- contributing-factor breakdown
  observed_status text                   -- active | closed (label from data)
);

-- Cohort assignment for "churches like yours" --------------------------------
create table if not exists church_cohort (
  church_id  uuid primary key references church(id) on delete cascade,
  size_band  text,                       -- <50 | 50-99 | 100-249 | 250-499 | 500+
  ethnicity  text,
  district   text,
  cohort_key text                        -- composite label
);

-- Conference-level model artifacts (growth drivers, etc.) --------------------
create table if not exists model_meta (
  key      text primary key,             -- e.g. 'growth_drivers'
  payload  jsonb not null,
  built_at timestamptz not null default now()
);

do $$
declare t text;
begin
  for t in select unnest(array['church_projection','church_vitality','church_cohort','model_meta'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
                   'public_read_' || t, t);
  end loop;
end$$;
