-- Era B districts (active 2023–) and Membership stat_fields (Section J Membership table).
-- Field codes are GCFA-canonical; labels match 2025 journal headers.

insert into district (code, name, status, valid_from) values
  ('CE', 'Central', 'active', 2023),
  ('NO', 'North',   'active', 2023),
  ('SO', 'South',   'active', 2023)
on conflict (code) do nothing;

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('1',  'Members Reported at Beginning of Year',                    'membership', 'count', 2015),
  ('2a', 'Received by Profession of Faith Through Confirmation',     'membership', 'count', 2015),
  ('2b', 'Received by Profession of Faith Other Than Confirmation',  'membership', 'count', 2015),
  ('2c', 'Restored by Affirmation of Faith',                         'membership', 'count', 2015),
  ('2d', 'Added by Correction',                                      'membership', 'count', 2015),
  ('2e', 'Received from Other UM Church',                            'membership', 'count', 2015),
  ('2f', 'Received from non-UM Church',                              'membership', 'count', 2015),
  ('2g', 'Members Received from Other Closed and Disaffiliated UMC Church', 'membership', 'count', 2015),
  ('3a', 'Removed by Charge Conference',                             'membership', 'count', 2015),
  ('3b', 'Withdrawn',                                                'membership', 'count', 2015),
  ('3c', 'Removed by Correction',                                    'membership', 'count', 2015),
  ('3d', 'Transferred to Other UM Church',                           'membership', 'count', 2015),
  ('3e', 'Transferred to non-UM Church',                             'membership', 'count', 2015),
  ('3f', 'Removed by Death',                                         'membership', 'count', 2015),
  ('4',  'Members Reported Year End',                                'membership', 'count', 2015)
on conflict (code) do nothing;
