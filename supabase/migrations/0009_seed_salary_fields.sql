-- Section J Salary and Benefits stat_fields (Era B / 2025).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('39',  'Clergy Pension',                                  'finance', 'usd', 2015),
  ('40',  'Clergy Health Benefits',                          'finance', 'usd', 2015),
  ('41a', 'Paid to Senior Pastor',                           'finance', 'usd', 2015),
  ('41b', 'Paid to Associate Pastor',                        'finance', 'usd', 2015),
  ('41c', 'Paid to Deacons',                                 'finance', 'usd', 2015),
  ('42a', 'Senior Pastor Housing and Utilities',             'finance', 'usd', 2015),
  ('42b', 'Associate Pastor Housing and Utilities',          'finance', 'usd', 2015),
  ('42c', 'Deacons Housing and Utilities',                   'finance', 'usd', 2015),
  ('43',  'Paid Utilities to Pastor / Associate',            'finance', 'usd', 2015),
  ('44',  'Non-Paid Accountable Reimbursement',              'finance', 'usd', 2015),
  ('45',  'Salary and Benefits for Other Church Staff',      'finance', 'usd', 2015),
  ('46',  'Other Expenses (1)',                              'finance', 'usd', 2015),
  ('47',  'Other Expenses (2)',                              'finance', 'usd', 2015),
  ('47t', 'Total Other Expenses',                            'finance', 'usd', 2015)
on conflict (code) do nothing;
