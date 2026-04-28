-- Section J Members by Ethnicity and Gender stat_fields (Era B / 2025).
-- Codes 5/6 are computed totals printed alongside the breakdown columns.

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('5a', 'Asian',                      'ethnicity', 'count', 2015),
  ('5b', 'Black',                      'ethnicity', 'count', 2015),
  ('5c', 'Hispanic/Latino',            'ethnicity', 'count', 2015),
  ('5d', 'Native American',            'ethnicity', 'count', 2015),
  ('5e', 'Pacific Islander',           'ethnicity', 'count', 2015),
  ('5f', 'White',                      'ethnicity', 'count', 2015),
  ('5g', 'Multi-Racial',               'ethnicity', 'count', 2015),
  ('5',  'Total Ethnicity',            'ethnicity', 'count', 2015),
  -- Gender uses category='other' because stat_field_category_check excludes 'gender'.
  ('6a', 'Female',                     'other',     'count', 2015),
  ('6b', 'Male',                       'other',     'count', 2015),
  ('6c', 'Nonbinary',                  'other',     'count', 2015),
  ('6',  'Total Gender',               'other',     'count', 2015)
on conflict (code) do nothing;
