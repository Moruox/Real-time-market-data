import datetime as dt
import unittest
from scripts.analytics_data import technical, closed_cutoff, valuation_rows, factsheet_text

class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.item = {'zone':'Asia/Shanghai', 'closeAfter':'15:15'}
        self.now = dt.datetime.fromisoformat('2026-10-21T12:00:00+08:00')

    def test_intraday_bar_excluded_but_previous_us_close_included(self):
        self.assertEqual(closed_cutoff(self.item, self.now).isoformat(), '2026-10-20')
        us = {'zone':'America/New_York','closeAfter':'16:15'}
        self.assertEqual(closed_cutoff(us,self.now).isoformat(),'2026-10-20')
        after = dt.datetime.fromisoformat('2026-10-21T15:20:00+08:00')
        self.assertEqual(closed_cutoff(self.item,after).isoformat(),'2026-10-21')

    def test_constant_prices_give_neutral_rsi_and_no_drawdown(self):
        rows = [[(dt.date(2025,10,1)+dt.timedelta(days=i)).isoformat(),100] for i in range(300)]
        rows.append(['2026-10-21',200])
        t = technical(rows,self.item,self.now,'fixture','https://example.com')
        self.assertEqual(t['rsi14'],50)
        self.assertEqual(t['ma200'],100)
        self.assertEqual(t['drawdownPct'],0)
        self.assertEqual(t['sampleSize'],252)
        self.assertEqual(t['close'],100)

    def test_rolling_mean_drawdown_and_rsi(self):
        rows = [[(dt.date(2025,10,1)+dt.timedelta(days=i)).isoformat(),i+100] for i in range(300)]
        t = technical(rows,self.item,self.now,'fixture','https://example.com')
        self.assertAlmostEqual(t['ma200'],sum(range(200,400))/200)
        self.assertEqual(t['rsi14'],100)
        self.assertEqual(t['high252'],399)
        self.assertEqual(t['drawdownPct'],0)

    def test_wilder_rsi_known_initial_average(self):
        values=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28]
        rows=[[(dt.date(2026,9,1)+dt.timedelta(days=i)).isoformat(),v] for i,v in enumerate(values)]
        t=technical(rows,self.item,self.now,'fixture','https://example.com')
        self.assertAlmostEqual(t['rsi14'],70.464135,places=5)

    def test_dated_official_columns_reject_zero_future_and_wrong_index(self):
        headers=['日期Date','指数代码Index Code','P/E1','P/E2','D/P1']
        rows=[headers,['20261201','000300',20,21,1],['20261020','000300',14.08,15.62,2.8]]
        v=valuation_rows(rows,'000300',self.now,'https://example.com')
        self.assertEqual(v['date'],'2026-10-20')
        self.assertEqual(v['pe'],14.08)
        self.assertEqual(v['dividendYield'],2.8)
        with self.assertRaises(ValueError): valuation_rows([headers,['20261020','000300',0,0,0]],'000300',self.now,'x')
        with self.assertRaises(ValueError): valuation_rows(rows,'000905',self.now,'x')

    def test_monthly_pb_has_independent_date(self):
        p=factsheet_text('2026年9月30日 指数代码 000300 市净率   1.36','000300',self.now,'https://example.com')
        self.assertEqual(p['pb'],1.36)
        self.assertEqual(p['date'],'2026-09-30')
        with self.assertRaises(ValueError): factsheet_text('2026年9月30日 指数代码 000905 市净率 1.36','000300',self.now,'x')

if __name__ == '__main__': unittest.main()
