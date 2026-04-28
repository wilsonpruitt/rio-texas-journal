-- Rio Texas Journal — initial schema
-- See ~/wroot-labs/notes/rio-texas-journal-discovery.md for design rationale.
-- Tall stats, normalized identity, era-aware ingest tracking.

create extension if not exists "pgcrypto";

create table journal (
  year          int primary key,
  pdf_path      text not null,
  data_year     int not null,
  parser_era    text not null check (parser_era in ('a', 'b')),
  ingested_at   timestamptz,
  sections      jsonb not null default '{}'::jsonb
);

create table district (
  code          text primary key,
  name          text not null,
  status        text not null default 'active' check (status in ('active','merged','renamed')),
  merged_into   text references district(code),
  valid_from    int not null,
  valid_to      int
);

create table church (
  id              uuid primary key default gen_random_uuid(),
  canonical_name  text not null unique,
  city            text,
  status          text not null default 'active' check (status in ('active','closed','merged','disaffiliated')),
  closed_year     int,
  merged_into     uuid references church(id),
  notes           text,
  lat             numeric(9,6),
  lng             numeric(9,6)
);

create table church_alias (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references church(id) on delete cascade,
  alias           text not null,
  source_section  text check (source_section in ('A','B','C','E','F','G','H','I','J','K','L')),
  journal_year    int references journal(year),
  unique (alias, journal_year, source_section)
);
create index on church_alias (church_id);
create index on church_alias (alias);

create table district_history (
  church_id       uuid not null references church(id) on delete cascade,
  data_year       int not null,
  district_code   text not null references district(code),
  primary key (church_id, data_year)
);

create table stat_field (
  code            text primary key,
  label_en        text not null,
  label_es        text,
  category        text not null check (category in ('membership','ethnicity','worship','finance','groups','other')),
  unit            text not null check (unit in ('count','usd','percent','text')),
  first_seen_year int,
  last_seen_year  int
);

create table church_stat (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references church(id) on delete cascade,
  data_year       int not null,
  journal_year    int not null references journal(year),
  field_code      text not null references stat_field(code),
  value_numeric   numeric,
  value_text      text,
  source_pdf_page int,
  parser_version  text not null,
  confidence      text not null default 'ok' check (confidence in ('ok','needs_review','non_reported'))
);
create index on church_stat (church_id, data_year, field_code);
create index on church_stat (journal_year);
create unique index church_stat_unique on church_stat (church_id, data_year, field_code);

create table clergy (
  id              uuid primary key default gen_random_uuid(),
  canonical_name  text not null unique,
  status_history  jsonb not null default '[]'::jsonb
);

create table clergy_alias (
  id              uuid primary key default gen_random_uuid(),
  clergy_id       uuid not null references clergy(id) on delete cascade,
  alias           text not null,
  journal_year    int references journal(year),
  unique (alias, journal_year)
);
create index on clergy_alias (clergy_id);

create table appointment (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references church(id) on delete cascade,
  clergy_id       uuid not null references clergy(id) on delete cascade,
  journal_year    int not null references journal(year),
  role            text,
  status_code     text,
  years_at_appt   int,
  fraction        text,
  source_pdf_page int
);
create index on appointment (church_id, journal_year);
create index on appointment (clergy_id, journal_year);

create table ingest_run (
  id              uuid primary key default gen_random_uuid(),
  journal_year    int not null references journal(year),
  section         text not null,
  parser_version  text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_written    int not null default 0,
  error_count     int not null default 0,
  notes           text
);
create index on ingest_run (journal_year, section);
