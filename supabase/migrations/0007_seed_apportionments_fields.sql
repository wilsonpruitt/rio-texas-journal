-- Section J Apportionments stat_fields (Era B / 2025).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('28a', 'Amount Apportioned by the Conference', 'finance', 'usd', 2015),
  ('28b', 'Amount Apportioned for District',      'finance', 'usd', 2015),
  ('29a', 'Paid Conference Apportionments',       'finance', 'usd', 2015),
  ('29b', 'Paid District Apportionments',         'finance', 'usd', 2015)
on conflict (code) do nothing;
