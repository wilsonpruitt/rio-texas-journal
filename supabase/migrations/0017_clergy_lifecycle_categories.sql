-- Add 'honorable_location' and 'extension_ministry' as recognized clergy
-- lifecycle states. Both are common UMC categories that previously fell
-- into the 'unknown' or 'active' buckets:
--   honorable_location  — voluntary inactive status (CONF REL code HN/HR)
--   extension_ministry  — FE/PE/FD/PD appointed beyond the local church
--                         (chaplains, professors, agency staff). Listed
--                         in BAC §31 each year.

alter table clergy
  drop constraint if exists clergy_status_check;

alter table clergy
  add constraint clergy_status_check
    check (status in (
      'active',
      'retired',
      'withdrawn',
      'deceased',
      'transferred',
      'honorable_location',
      'extension_ministry',
      'unknown'
    ));
