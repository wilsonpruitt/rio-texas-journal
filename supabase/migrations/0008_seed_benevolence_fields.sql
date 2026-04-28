-- Section J Benevolence and Connectional Support stat_fields (Era B / 2025).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('30',  'Paid General Advance',                  'finance', 'usd', 2015),
  ('31',  'Paid World Service',                    'finance', 'usd', 2015),
  ('32',  'Paid Conference Advance',               'finance', 'usd', 2015),
  ('33',  'Paid Youth Service Fund',               'finance', 'usd', 2015),
  ('34',  'Paid Other Funds',                      'finance', 'usd', 2015),
  ('35',  'Paid Special Sunday',                   'finance', 'usd', 2015),
  ('36a', 'Paid Human Relations',                  'finance', 'usd', 2015),
  ('36b', 'Paid UMCOR Sunday',                     'finance', 'usd', 2015),
  ('36c', 'Paid Peace with Justice',               'finance', 'usd', 2015),
  ('36d', 'Paid Native American',                  'finance', 'usd', 2015),
  ('36e', 'Paid World Communion',                  'finance', 'usd', 2015),
  ('36f', 'Paid UMS Student Day',                  'finance', 'usd', 2015),
  ('37',  'Paid Directly to UM Causes',            'finance', 'usd', 2015),
  ('38',  'Paid Directly to Non-UM Causes',        'finance', 'usd', 2015)
on conflict (code) do nothing;
