-- Add mailing address and phone to church for Section F (Appointments) data.
-- These reflect the most-recently-parsed journal's authoritative contact info.

alter table church add column if not exists mailing_address text;
alter table church add column if not exists phone          text;
