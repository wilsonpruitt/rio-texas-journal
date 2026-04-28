-- Prevent re-runs from blind-inserting duplicate appointment rows.
-- Each (clergy, church, year) combination should appear at most once.

create unique index if not exists appointment_clergy_church_year_uq
  on appointment (clergy_id, church_id, journal_year);
