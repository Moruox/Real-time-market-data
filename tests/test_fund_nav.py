import datetime as dt
import unittest
from scripts.fund_nav import adjusted_nav

NOW=dt.datetime.fromisoformat('2026-10-21T12:00:00+08:00')
START=dt.datetime.fromisoformat('2026-01-01T00:00:00+08:00')
def row(i,nav=1,change=0,event=''):
    return dict(x=(START+dt.timedelta(days=i)).timestamp()*1000,y=nav,equityReturn=change,unitMoney=event)

class AdjustedNAVTests(unittest.TestCase):
    def test_dividend_is_reinvested_instead_of_a_false_drawdown(self):
        points=[row(i) for i in range(260)]
        for i in range(200,260):points[i]=row(i,.8,0,'分红：每10份派现金元' if i==200 else '')
        a=adjusted_nav(points,'000001',NOW)
        self.assertEqual(a['status'],'ready')
        self.assertAlmostEqual(a['technical']['drawdownPct'],0)
        self.assertAlmostEqual(a['history'][-1]['value'],100)
        self.assertEqual(a['technical']['rsi14'],50)

    def test_split_does_not_create_a_crash(self):
        points=[row(i) for i in range(260)]
        for i in range(240,260):points[i]=row(i,.5,0,'拆分：每份拆分为2份' if i==240 else '')
        self.assertEqual(adjusted_nav(points,'000001',NOW)['technical']['drawdownPct'],0)

    def test_unadjusted_dividend_returns_are_rejected(self):
        points=[row(i) for i in range(260)]
        points[-1]=row(259,.8,-20,'分红：每10份派现金元')
        a=adjusted_nav(points,'000001',NOW)
        self.assertEqual(a['sampleSize'],1)
        self.assertNotIn('technical',a)
        self.assertEqual(a['status'],'insufficient')

    def test_missing_return_and_unexplained_jump_reset_the_window(self):
        for last in [row(259,1,None),row(259,.5,0),row(259,1,-100),row(259,1,float('nan'))]:
            a=adjusted_nav([row(i) for i in range(259)]+[last],'000001',NOW)
            self.assertEqual(a['sampleSize'],1)
            self.assertNotIn('technical',a)

    def test_return_chain_compounds_and_is_not_raw_nav(self):
        points=[row(0,1),row(1,.9,0,'分红：每10份派现金元'),row(2,.99,10)]
        a=adjusted_nav(points,'000001',NOW)
        self.assertAlmostEqual(a['history'][-1]['value'],110)
        self.assertEqual(a['status'],'insufficient')

    def test_conflicts_long_gaps_and_future_observations(self):
        a=adjusted_nav([row(0),row(0,2)],'000001',NOW)
        self.assertEqual(a['status'],'unavailable')
        a=adjusted_nav([row(0),row(20),row(1000,100,10)],'000001',NOW)
        self.assertEqual(a['sampleSize'],1)
        self.assertEqual(a['asOf'],'2026-01-21')

if __name__=='__main__':unittest.main()
