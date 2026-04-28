-- All journal data is public. Enable RLS explicitly and grant anon SELECT on every table.
-- Writes still require service_role (bypasses RLS).

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in (
        'journal','district','church','church_alias','district_history',
        'stat_field','church_stat','clergy','clergy_alias','appointment','ingest_run'
      )
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      'public_read_' || t, t
    );
  end loop;
end$$;
