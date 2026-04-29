-- Track each clergyperson's current credential class (FE/FD/PE/PD/FL/PL/
-- AM/etc.) as a first-class field, separately from lifecycle status.
--
-- Status answers "are they currently active in ministry?" — credential
-- class answers "what kind of clergy are they?". A retired Full Elder
-- has status='retired' and credential_class='FE'. A part-time local
-- pastor between annual appointments may show as status='unknown' but
-- credential_class='PL', preserving the credential signal.
--
-- The set of codes is the union of UMC CONF REL codes used in Rio
-- Texas. New codes are accepted (no check constraint) since the
-- Discipline occasionally adds them; the UI maps known codes to
-- human-readable labels and falls back to the raw code otherwise.

alter table clergy
  add column if not exists credential_class text;

create index if not exists clergy_credential_class_idx on clergy (credential_class);
