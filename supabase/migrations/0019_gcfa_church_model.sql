-- Phase 2: GCFA local-church statistical model (2000-2024) becomes authoritative.
-- Adds GCFA church identity, source tagging on church_stat, and codebook metadata on
-- stat_field. Variable-name field codes (MEMBPREV, MEMBTOT, AVATTWOR...) are the canonical
-- statistical vocabulary going forward; legacy journal-parsed rows keep their numeric form
-- codes ('1','2a'...) and are tagged source='journal'. Nothing is deleted.

-- 1. church identity (keyed by stable GCFA church number) ---------------------
alter table church
  add column if not exists gcfa_number        text,
  add column if not exists gcfa_id            text,
  add column if not exists address            text,
  add column if not exists state              text,
  add column if not exists zip                text,
  add column if not exists county_no          text,
  add column if not exists county_name        text,
  add column if not exists congregation_type  text,
  add column if not exists church_ethnicity   text,
  add column if not exists ein                text,
  add column if not exists charge_no          text,
  add column if not exists charge_name        text,
  add column if not exists legacy_conferences text[],
  add column if not exists first_data_year    int,
  add column if not exists last_data_year     int;

create unique index if not exists church_gcfa_number_key
  on church (gcfa_number) where gcfa_number is not null;

-- 2. stat_field: widen category vocabulary + carry codebook metadata ----------
alter table stat_field
  add column if not exists question       text,
  add column if not exists table_no       text,
  add column if not exists current_number text;

alter table stat_field drop constraint if exists stat_field_category_check;
alter table stat_field add constraint stat_field_category_check
  check (category in ('membership','ethnicity','demographics','worship',
                      'finance','giving','apportionments','groups','other'));

-- 3. church_stat: source tagging + allow GCFA rows (no journal) ----------------
alter table church_stat add column if not exists source text not null default 'journal';
alter table church_stat alter column journal_year drop not null;

drop index if exists church_stat_unique;
create unique index church_stat_unique
  on church_stat (church_id, data_year, field_code, source);
create index if not exists church_stat_source_idx on church_stat (source, data_year);
