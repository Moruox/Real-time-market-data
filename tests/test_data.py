import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('updater', ROOT / 'scripts/update_data.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class DataTests(unittest.TestCase):
    def test_bond_uses_settlement_not_previous_close(self):
        a = ['0'] * 38
        a[3], a[13], a[14], a[36], a[37] = '101', '100', '102', '2026-10-20', '14:00:00'
        text = 'var hq_str_nf_T0="' + ','.join(a) + '";'
        q = m.sina(text, [{'id': 't', 'sina': 'nf_T0', 'group': 'bonds'}], '2026-10-20T14:00:01+08:00')['t']
        self.assertAlmostEqual(q['changePct'], 1.)

    def test_missing_eastmoney_quote_not_zero(self):
        q = m.eastmoney({'data': {'diff': [{'f12': 'TM', 'f13': 220, 'f2': '-', 'f3': '-', 'f124': 1}]}}, [{'id':'t', 'eastmoney':'220.TM', 'group':'bonds'}], 'now')
        self.assertEqual(q, {})

    def test_snapshot_is_complete_and_finite(self):
        config = json.loads((ROOT / 'config.json').read_text())
        data = json.loads((ROOT / 'data/quotes.json').read_text())
        for item in config['instruments']:
            self.assertIn(item['id'], data['quotes'])
            q = data['quotes'][item['id']]
            self.assertTrue(m.valid(q['price'], q['changePct']))
            self.assertIn('quoteAt', q)
        self.assertNotIn('funds', data)
        self.assertEqual(len(config['instruments']), 45)
        for item in config['instruments']:
            if not item.get('analyze'):
                continue
            t = data['analysis'][item['id']]['technical']
            self.assertEqual(t['sampleSize'], 252)
            self.assertEqual(t['asOf'], t['history'][-1]['date'])
            self.assertGreater(t['ma200'], 0)
            self.assertLessEqual(t['drawdownPct'], 0)
            self.assertTrue(0 <= t['rsi14'] <= 100)

if __name__ == '__main__':
    unittest.main()
