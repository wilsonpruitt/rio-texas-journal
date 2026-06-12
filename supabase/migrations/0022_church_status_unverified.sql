-- Add 'unverified' to church.status: a church whose existence/status conflicts
-- with the July 2025 FINAL district roster and is hidden from the site until
-- Wilson confirms what happened to it (close vs disaffiliation).
alter table church
  drop constraint if exists church_status_check;
alter table church
  add constraint church_status_check
  check (status in ('active','closed','merged','disaffiliated','unverified'));
