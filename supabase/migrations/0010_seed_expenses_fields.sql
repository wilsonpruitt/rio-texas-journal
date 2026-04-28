-- Section J Expenses stat_fields (Era B / 2025).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('48', 'Paid on Debt',           'finance', 'usd', 2015),
  ('49', 'Paid Capital',           'finance', 'usd', 2015),
  ('50', 'Grand Total Paid',       'finance', 'usd', 2015)
on conflict (code) do nothing;
