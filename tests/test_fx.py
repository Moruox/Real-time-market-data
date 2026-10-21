import unittest
import datetime as dt
from scripts.update_fx import parse_ecb,CN
class FXTests(unittest.TestCase):
 def test_cross_rate_and_dates(self):
  xml='<root><Cube time="2026-10-20"><Cube currency="CNY" rate="8"/><Cube currency="USD" rate="2"/><Cube currency="JPY" rate="160"/><Cube currency="GBP" rate="NaN"/></Cube><Cube time="2026-10-22"><Cube currency="CNY" rate="9"/><Cube currency="USD" rate="1"/></Cube></root>'
  d=parse_ecb(xml,dt.datetime(2026,10,21,tzinfo=CN))
  self.assertEqual(d['asOf'],'2026-10-20');self.assertEqual(d['currencies']['USD']['history'][0]['cnyPerUnit'],4)
  self.assertEqual(d['currencies']['JPY']['history'][0]['cnyPerUnit'],.05);self.assertEqual(d['currencies']['EUR']['history'][0]['cnyPerUnit'],8);self.assertNotIn('GBP',d['currencies'])
 def test_missing_base_rejected(self):
  with self.assertRaises(ValueError):parse_ecb('<root><Cube time="2026-10-20"><Cube currency="USD" rate="1"/></Cube></root>',dt.datetime(2026,10,21,tzinfo=CN))
