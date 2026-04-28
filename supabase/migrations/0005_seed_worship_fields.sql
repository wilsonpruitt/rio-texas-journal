-- Section J Worship Attendance stat_fields (Era B / 2025).
-- Note: 8/8a/8b are baptism events and 9/10 are membership tallies — the
-- journal places them under the Worship Attendance section but they are
-- semantically membership-category fields.

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('7',  'Average Worship Attendance',     'worship',    'count', 2015),
  ('7a', 'Number Who Worship Online',      'worship',    'count', 2015),
  ('8a', 'Infants and Children Baptized',  'membership', 'count', 2015),
  ('8b', 'Youth and Adults Baptized',      'membership', 'count', 2015),
  ('8',  'Total Baptized',                 'membership', 'count', 2015),
  ('9',  'Baptized Members',               'membership', 'count', 2015),
  ('10', 'Constituence Members',           'membership', 'count', 2015)
on conflict (code) do nothing;
