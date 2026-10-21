import datetime as dt
import json
from pathlib import Path
import unittest
from scripts.update_qdii import catalog, quota_page, nav_series, history_update, fallback_quota

NOW=dt.datetime.fromisoformat('2026-10-21T12:00:00+08:00')

class QDIITests(unittest.TestCase):
    def test_catalog_distinguishes_otc_etf_and_equal_weight(self):
        rows=[['000001','x','测试纳斯达克100ETF联接(QDII)A','指数型-海外股票'],['000002','x','测试纳斯达克100ETF','指数型-海外股票'],['000003','x','测试标普500指数美元汇A','指数型-海外股票'],['000004','x','测试标普500等权重指数C人民币','指数型-海外股票'],['000005','x','测试纳斯达克生物科技指数A','指数型-海外股票']]
        funds,excluded=catalog('var r = '+json.dumps(rows)+';')
        self.assertEqual(set(funds),{'000001','000003','000004'})
        self.assertEqual(funds['000004']['index'],'sp500ew')
        self.assertEqual(funds['000003']['currency'],'USD')
        self.assertEqual(funds['000003']['shareClass'],'A')
        self.assertEqual(funds['000003']['family'],'测试标普500指数')
        self.assertEqual(len(excluded),1)

    def page(self,status='暂停申购',limit='10.00元'):
        return '<title>270042</title><table><tr><td>申购状态</td><td>'+status+'</td></tr><tr><td>日累计申购限额</td><td>'+limit+'</td></tr><tr><td>定投状态</td><td>不支持</td></tr><tr><td>管理费率</td><td>0.80%（每年）</td></tr></table>'

    def test_paused_state_is_preserved_with_numeric_page_limit(self):
        q=quota_page(self.page(),{'code':'270042'},NOW)
        self.assertEqual(q['state'],'paused')
        self.assertEqual(q['dailyLimit'],10)
        self.assertEqual(q['fees']['management'],0.8)

    def test_zero_blank_or_sentinel_never_implies_unlimited(self):
        for raw in ['0.00元','---','100000000000.00元']:
            q=quota_page(self.page('限大额',raw),{'code':'270042'},NOW)
            self.assertIsNone(q['dailyLimit'])
            self.assertFalse(q['unlimited'])
        q=quota_page(self.page('开放申购','无限额'),{'code':'270042'},NOW)
        self.assertTrue(q['unlimited'])

    def test_raw_unit_preserved_and_bad_page_does_not_verify(self):
        q=quota_page(self.page('限大额','25.00美元'),{'code':'270042'},NOW)
        self.assertEqual(q['dailyLimit'],25)
        self.assertEqual(q['limitUnit'],'美元')
        with self.assertRaises(ValueError):quota_page(self.page(),{'code':'999999'},NOW)

    def test_no_fake_historical_quota_records(self):
        q=quota_page(self.page(),{'code':'270042'},NOW)
        h=history_update([],q)
        self.assertEqual(len(h),1)
        q['checkedAt']='2026-10-21T12:15:00+08:00'
        self.assertEqual(len(history_update(h,q)),1)
        q['dailyLimit']=20;q['limitText']='20.00元'
        self.assertEqual(len(history_update(h,q)),2)
        q['verified']=False
        self.assertEqual(len(history_update(h,q)),1)

    def test_nav_currency_shares_are_not_substituted_and_future_rows_rejected(self):
        text='var fS_code="270042";var syl_1y="-1.2";var Data_netWorthTrend='+json.dumps([{'x':1792368000000,'y':1.1,'equityReturn':-0.5},{'x':1893456000000,'y':100,'equityReturn':900}])+';'
        n=nav_series(text,'270042',NOW)
        self.assertEqual(n['nav'],1.1)
        self.assertEqual(n['performance']['1m'],-1.2)
        with self.assertRaises(ValueError):nav_series(text,'000055',NOW)

    def test_snapshot_covers_catalog_and_every_share_has_explicit_identity(self):
        data=json.loads((Path(__file__).resolve().parents[1]/'data/qdii.json').read_text())
        self.assertGreater(len(data['funds']),0)
        self.assertEqual(data['schemaVersion'],1)
        for code,fund in data['funds'].items():
            self.assertEqual(code,fund['code'])
            self.assertIn(fund['currency'],['CNY','USD'])
            self.assertIn(fund['index'],['ndx','sp500','sp500ew'])
            self.assertTrue('ETF' not in fund['name'] or '联接' in fund['name'])
            if fund.get('navData'):
                self.assertGreater(fund['navData']['nav'],0)
                self.assertEqual(fund['navData']['navDate'],fund['navData']['history'][-1]['date'])

if __name__=='__main__':unittest.main()
