-- Section J Receipts stat_fields (Era B / 2025).

insert into stat_field (code, label_en, category, unit, first_seen_year) values
  ('51',  'Number of Giving Households',                              'finance', 'count', 2015),
  ('52a', 'Received through Pledges',                                 'finance', 'usd',   2015),
  ('52b', 'Received non-pledges',                                     'finance', 'usd',   2015),
  ('52c', 'Received from Unidentified Givers',                        'finance', 'usd',   2015),
  ('52d', 'Received Interest / Dividends',                            'finance', 'usd',   2015),
  ('52e', 'Received Sale of Assets',                                  'finance', 'usd',   2015),
  ('52f', 'Received Building Use',                                    'finance', 'usd',   2015),
  ('52g', 'Received through Fundraisers',                             'finance', 'usd',   2015),
  ('52',  'Funds Received Total',                                     'finance', 'usd',   2015),
  ('53a', 'Received Capital Campaign',                                'finance', 'usd',   2015),
  ('53b', 'Received Memorials / Endowments',                          'finance', 'usd',   2015),
  ('53c', 'Received Other Support',                                   'finance', 'usd',   2015),
  ('53d', 'Received from Directed Benevolences',                      'finance', 'usd',   2015),
  ('53e', 'Received from Sale of Church-Owned Real Estate',           'finance', 'usd',   2015),
  ('53',  'Total Income for Designated Causes',                       'finance', 'usd',   2015),
  ('54a', 'Received Equitable Compensation',                          'finance', 'usd',   2015),
  ('54b', 'Received Advance Specials',                                'finance', 'usd',   2015),
  ('54c', 'Received Other Grants',                                    'finance', 'usd',   2015),
  ('54',  'Total Connectional Income',                                'finance', 'usd',   2015),
  ('55',  'Grand Total Received',                                     'finance', 'usd',   2015)
on conflict (code) do nothing;
