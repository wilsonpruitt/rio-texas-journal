-- Section J Other Groups stat_fields (Era B / 2025).
-- Three sub-tables share this section header: Christian Formation (11a–14),
-- Classes/UMM/UWF/UMVIM (15–20b), Community Ministries + Property/Debt (21–27).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('11a', 'Children in Christian Formation Groups',           'groups',     'count', 2015),
  ('11b', 'Youth in Christian Formation Groups',              'groups',     'count', 2015),
  ('11c', 'Young Adults in Christian Formation Groups',       'groups',     'count', 2015),
  ('11d', 'Adults in Christian Formation Groups',             'groups',     'count', 2015),
  ('11',  'Total Christian Formation Groups',                 'groups',     'count', 2015),
  ('12',  'Confirmation Classes',                             'groups',     'count', 2015),
  ('13',  'Average Attendance in Sunday School',              'groups',     'count', 2015),
  ('14',  'Vacation Bible School',                            'groups',     'count', 2015),
  ('15',  'Number of Ongoing Sunday School Classes',          'groups',     'count', 2015),
  ('16',  'Number of Ongoing Non-Sunday School Classes',      'groups',     'count', 2015),
  ('17',  'Number of Short-Term Classes',                     'groups',     'count', 2015),
  ('18a', 'Members in United Methodist Men',                  'groups',     'count', 2015),
  ('18b', 'Paid Directly by United Methodist Men',            'groups',     'usd',   2015),
  ('19a', 'Members in United Women in Faith',                 'groups',     'count', 2015),
  ('19b', 'Paid Directly by United Women in Faith',           'groups',     'usd',   2015),
  ('20a', 'Number of UMVIM Teams',                            'groups',     'count', 2015),
  ('20b', 'Number of UMVIM Team Members',                     'groups',     'count', 2015),
  ('21',  'Number of Community Ministries',                   'groups',     'count', 2015),
  ('21a', 'Number Focus on Global/Regional Health',           'groups',     'count', 2015),
  ('21b', 'Number Focus on Poor/Socially Marginalized',       'groups',     'count', 2015),
  ('22',  'Number Serving in Mission/Community Ministries',   'groups',     'count', 2015),
  ('23',  'Number of Persons Served by Community Ministries', 'groups',     'count', 2015),
  ('24',  'Value of Land, Buildings and Equipment',           'finance',    'usd',   2015),
  ('25',  'Value of Other Liquid Assets',                     'finance',    'usd',   2015),
  ('26',  'Debt by Assets',                                   'finance',    'usd',   2015),
  ('27',  'Other Debt',                                       'finance',    'usd',   2015)
on conflict (code) do nothing;
