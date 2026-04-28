-- Era A historical districts (active 2014–2023; consolidated into Era B
-- Central / North / South for the 2025 conference year).

insert into district (code, name, status, valid_from, valid_to) values
  ('CA', 'Capital',      'merged', 2014, 2023),
  ('CB', 'Coastal Bend', 'merged', 2014, 2023),
  ('CR', 'Crossroads',   'merged', 2014, 2023),
  ('EV', 'El Valle',     'merged', 2014, 2023),
  ('HC', 'Hill Country', 'merged', 2014, 2023),
  ('LM', 'Las Misiones', 'merged', 2014, 2023),
  ('WS', 'West',         'merged', 2014, 2023)
on conflict (code) do nothing;
