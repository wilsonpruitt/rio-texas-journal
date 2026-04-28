-- Add a status field to clergy parallel to church.status. Values follow the
-- common ministerial-life-cycle terms used in UMC reporting.

alter table clergy
  add column if not exists status text not null default 'active'
    check (status in ('active', 'retired', 'withdrawn', 'deceased', 'transferred', 'unknown'));
