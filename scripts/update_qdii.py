"""Discover mainland OTC QDII shares; preserve source-specific quotas."""
import concurrent.futures
import datetime as dt
import html
import json
import math
import pathlib
import re
import subprocess
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
CN = ZoneInfo('Asia/Shanghai')
CATALOG_URL = 'https://fund.eastmoney.com/js/fundcode_search.js'
TRADE_URL = 'https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=8&page=1,50000&js=reData&sort=fcode,asc'
PUBLIC_URL = 'https://moruox.github.io/Real-time-market-data/data/qdii.json'
# Ordered specific index identities; never map a sector/strategy to a broad index.
INDEX_RULES = [
 ('sp500ew','标普500等权',r'标普(?:美国)?500.*等权',None),
 ('ndx','纳斯达克100',r'纳斯达克100|纳指100','ndx'),
 ('sp500','标普500',r'标普(?:美国)?500','sp500'),
 ('nbi','纳斯达克生物科技',r'纳斯达克生物|广发生物科技指数','nbi'),
 ('ftse','英国富时100',r'富时100','ftse'),
 ('sp100ew','标普100等权',r'标普100.*等权',None),
 ('overseasInternet50','中证海外互联网50',r'海外互联网50',None),
 ('chinaUsInternet','中证中美互联网',r'中美互联网',None),
 ('nasdaqTech','纳斯达克科技',r'纳斯达克科技',None),
 ('spIT','标普信息科技',r'标普信息科技',None),
 ('hkConsumer','恒生消费',r'恒生消费',None),
 ('spConsumer','标普消费',r'标普(?:美国)?消费',None),
 ('hkInnovative','港股创新药',r'港股创新药',None),
 ('hkHealth','恒生医疗保健',r'恒生医疗保健',None),
 ('spHealth','标普医疗保健',r'标普医疗保健',None),
 ('cnkrChip','中韩半导体',r'中韩半导体',None),
 ('seaTech','东南亚科技',r'东南亚科技',None),
 ('hkState','中证香港内地国有企业',r'香港内地国有企业',None),
 ('hkSmall','香港小型股',r'香港小型股',None),
 ('asiaSelect','亚太精选指数',r'亚太精选',None),
 ('djOil','道琼斯石油',r'道琼斯石油',None),
 ('spGlobalOil','标普全球石油',r'标普全球石油',None),
 ('spOilGas','标普油气行业',r'标普(?:油气|石油天然气)',None),
 ('usRealEstate','美国房地产指数',r'美国房地产',None),
 ('ftseReit','富时发达市场REITs',r'富时发达市场REIT',None),
 ('usReit','美国精选REIT',r'美国精选REIT',None),
 ('hstech','恒生科技',r'恒生科技','hstech'),
 ('hscei','恒生国企',r'恒生(?:中国企业|国企)','hscei'),
 ('hsi','恒生指数',r'恒生(?:指数|ETF|交易型)','hsi'),
 ('hkbank','中证香港银行',r'中证香港银行','hkbank'),
 ('nikkei','日经225',r'日经225','nikkei'),
 ('topix','日本东证',r'日本东证',None),
 ('dax','德国DAX',r'DAX|德国30','dax'),
 ('france','法国CAC40',r'CAC40','cac'),
 ('stoxx','欧洲指数',r'欧洲|欧元区',None),
 ('india','印度指数',r'印度',None),
 ('vietnam','越南指数',r'越南',None),
 ('hkInternet','恒生互联网',r'恒生互联网',None),
 ('chinaInternet','中国互联网',r'中国互联网|中国互联',None),
 ('hkTech','香港科技',r'香港科技',None),
 ('health','海外医疗指数',r'医疗|医药|生物',None),
 ('tech','海外科技指数',r'科技|芯片|半导体|信息技术',None),
 ('dividend','海外红利指数',r'红利|股息|高分红',None),
 ('reitIndex','REITs / 地产指数',r'REIT|房地产|地产',None),
 ('energyIndex','能源股票指数',r'石油|油气|能源',None),
 ('consumer','海外消费指数',r'消费',None),
 ('globalIndex','全球 / 其他海外指数',r'.*',None),
]


def classify(name, kind):
    passive = '指数' in kind or '指数' in name or ('ETF' in name.upper() and '联接' in name)
    # Some index trackers are registered as QDII-FOF.
    passive = passive or bool(re.search(r'纳斯达克100|纳指100|标普(?:美国)?500',name))
    if '商品' in kind or '纯债' in kind or '混合债' in kind:passive=False
    if passive:
        for key,label,pattern,benchmark in INDEX_RULES:
            if re.search(pattern,name,re.I):
                # Only exact index families get the market dashboard's signal.
                if re.search(r'增强|反向|杠杆|两倍|三倍|低波|质量|成长|等权',name):benchmark=None
                return key,label,benchmark,'index','指数基金'
    if '纯债' in kind or '混合债' in kind:return 'bond','海外债券',None,'bond','债券基金'
    if '商品' in kind:
        key='gold' if re.search('黄金|贵金属',name) else 'oil' if re.search('原油|石油|油气',name) else 'commodity'
        return key,{'gold':'黄金 / 贵金属','oil':'原油 / 商品','commodity':'其他商品'}[key],None,'commodity','商品基金'
    if 'REIT' in kind:return 'reit','主动REITs / 地产',None,'reit','REITs基金'
    if 'FOF' in kind:return 'fof','全球配置FOF',None,'allocation','多资产 / FOF'
    if '股票' in kind or '混合偏股' in kind:
        key='activeTech' if re.search('科技|数字|芯片|互联网|人工智能',name) else 'activeAsia' if re.search('亚洲|亚太|港股|中国|中华',name) else 'activeGlobal'
        return key,{'activeTech':'主动科技 / 主题','activeAsia':'主动亚洲 / 大中华','activeGlobal':'主动全球股票'}[key],None,'active','主动权益'
    return 'allocation','主动多资产配置',None,'allocation','多资产 / FOF'


def request(url):
    return subprocess.check_output(['curl','--fail','--compressed','-L','--connect-timeout','4',
        '--max-time','18','--retry','1','--retry-delay','1','-sS','-A','Mozilla/5.0','-H','Referer: https://fund.eastmoney.com/',url],
        stderr=subprocess.DEVNULL).decode('utf-8-sig')


def number(value, positive=False):
    try:
        n = float(value)
        return n if math.isfinite(n) and (n > 0 if positive else n >= 0) else None
    except (ValueError, TypeError):
        return None


def catalog(text):
    match = re.search(r'(?:var\s+)?r\s*=\s*(\[)', text)
    if not match:
        raise ValueError('Fund catalog missing')
    rows, _ = json.JSONDecoder().raw_decode(text[match.start(1):])
    funds, excluded = {}, []
    for row in rows:
        if len(row) < 4 or not re.fullmatch(r'\d{6}', row[0]):
            continue
        code, name, kind = row[0], row[2], row[3]
        compact = re.sub(r'\s+', '', name)
        if 'QDII' not in kind and '海外' not in kind:
            continue
        if 'ETF' in name.upper() and '联接' not in name:
            excluded.append({'code':code,'name':name,'reason':'纯场内ETF，不属于场外份额'})
            continue
        index,label,benchmark,category,category_name=classify(compact,kind)
        currency = 'USD' if re.search('美元|美汇|美钞', name) else 'CNY'
        base = re.sub(r'\([^)]*\)|（[^）]*）', '', name)
        m = re.search(r'([ACDEFI])(?=人民币|美元|$)', base)
        share = m.group(1) if m else '未标注'
        family = re.sub(r'美元现汇|美元现钞|美元汇|人民币|美元|现汇|现钞|美汇|美钞', '', base)
        family = family.replace('纳指100', '纳斯达克100')
        family = re.sub(r'[ACDEFI]$', '', family)
        funds[code] = dict(code=code,name=name,index=index,indexName=label,benchmark=benchmark,category=category,categoryName=category_name,currency=currency,
            shareClass=share,family=family,type=kind,url=f'https://fund.eastmoney.com/{code}.html')
    if not funds:
        raise ValueError('No matching OTC shares')
    return funds, excluded


def trade_rows(text):
    match = re.search(r'datas\s*:', text)
    if not match:
        raise ValueError('Purchase state table missing')
    rows, _ = json.JSONDecoder().raw_decode(text[match.end():].lstrip())
    return {r[0]:r for r in rows if len(r) >= 13 and re.fullmatch(r'\d{6}', str(r[0]))}


def clean(text):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', '', text))).strip()


def quota_page(text, fund, now):
    if fund['code'] not in text:
        raise ValueError('Wrong fund quota page')
    def field(name):
        m = re.search(r'<td[^>]*>\s*' + re.escape(name) + r'\s*</td>\s*<td[^>]*>(.*?)</td>', text, re.S)
        return clean(m.group(1)) if m else None
    status = field('申购状态')
    if not status or not re.search(r'申购|封闭|认购|开放|限', status):
        raise ValueError('Subscription status missing')
    raw = field('日累计申购限额')
    limit = None
    unit = None
    if raw:
        m = re.fullmatch(r'([\d,.]+)\s*(元|美元|人民币|USD|CNY)', raw)
        if m:
            limit = number(m.group(1).replace(',',''), positive=True)
            unit = m.group(2)
    unlimited = bool(raw and re.search(r'无(?:限额|限制)|不限', raw))
    # A zero, blank or sentinel value does not establish unlimited buying power.
    if limit is not None and limit >= 1e10:
        limit = None
        unlimited = False
    minimum = field('申购起点')
    def amount(s):
        m = re.search(r'([\d,.]+)', s or '')
        return number(m.group(1).replace(',','')) if m else None
    def fee(name):
        value = field(name)
        return amount(value) if value and '%' in value else None
    paused = bool(re.search(r'暂停|封闭|停止|不开放|不支持', status))
    return dict(status=status,state='paused' if paused else 'limited' if re.search(r'限|大额', status) else 'open',
        dailyLimit=limit,limitText=raw,limitUnit=unit,unlimited=unlimited,minimum=amount(minimum),minimumText=minimum,
        dcaStatus=field('定投状态') or '未披露',channel='天天基金',source='天天基金交易费率页',verified=True,
        checkedAt=now.isoformat(timespec='seconds'),url=f"https://fundf10.eastmoney.com/jjfl_{fund['code']}.html",
        fees=dict(management=fee('管理费率'),custody=fee('托管费率'),service=fee('销售服务费率')))


def fallback_quota(row, now):
    # The general state table is not sufficient to verify a particular sales channel.
    limit = number(row[9], positive=True)
    if limit is not None and limit >= 1e10:
        limit = None
    status = row[5]
    return dict(status=status,state='paused' if re.search('暂停|封闭|停止',status) else 'unverified',
        dailyLimit=limit,limitText=None,limitUnit=None,unlimited=False,minimum=number(row[8]),minimumText=None,
        dcaStatus='未核实',channel='公开状态表（备用）',source='天天基金申购状态表',verified=False,
        checkedAt=now.isoformat(timespec='seconds'),url='https://fund.eastmoney.com/Fund_sgzt_bzdm.html')


def nav_series(text, code, now):
    identity = re.search(r'var\s+fS_code\s*=\s*[\'"]([^\'"]+)', text)
    if not identity or identity.group(1) != code:
        raise ValueError('Wrong fund NAV series')
    match = re.search(r'var\s+Data_netWorthTrend\s*=\s*(\[.*?\]);',text,re.S)
    if not match:
        raise ValueError('NAV series missing')
    rows = json.loads(match.group(1))
    history = {}
    for row in rows:
        try:
            date = dt.datetime.fromtimestamp(float(row['x'])/1000,CN).date()
            value = number(row['y'],positive=True)
            if value is not None and date <= now.date():
                try:change=float(row['equityReturn'])
                except (ValueError,TypeError,KeyError):change=None
                if change is not None and (not math.isfinite(change) or abs(change)>1000):change=None
                history[date.isoformat()] = dict(date=date.isoformat(),nav=value,changePct=change)
        except (ValueError,TypeError,KeyError,OverflowError):
            continue
    points = [v for _,v in sorted(history.items())][-252:]
    if not points:
        raise ValueError('No valid NAV observations')
    perf = {}
    for period, variable in [('1m','syl_1y'),('3m','syl_3y'),('6m','syl_6y'),('1y','syl_1n')]:
        m = re.search(r'var\s+'+variable+r'\s*=\s*[\'"]([^\'"]*)',text)
        try:
            value=float(m.group(1)) if m else None
            perf[period]=value if value is not None and math.isfinite(value) and abs(value)<=10000 else None
        except ValueError:
            perf[period]=None
    last = points[-1]
    return dict(nav=last['nav'],navDate=last['date'],changePct=last['changePct'],history=[dict(date=p['date'],nav=p['nav']) for p in points],performance=perf,
        fetchedAt=now.isoformat(timespec='seconds'),source='天天基金已公布净值',url=f'https://fund.eastmoney.com/pingzhongdata/{code}.js')


def history_update(old, quota):
    points = list(old or [])
    if not quota or not quota.get('verified'):
        return points
    key = {k:quota.get(k) for k in ['state','status','dailyLimit','limitText','limitUnit','unlimited']}
    point = dict(key,at=quota['checkedAt'])
    if not points or any(points[-1].get(k)!=v for k,v in key.items()) or points[-1]['at'][:10] != point['at'][:10]:
        points.append(point)
    return points[-180:]


def recent(value, field, now, hours):
    try:return 0 <= (now-dt.datetime.fromisoformat(value[field])).total_seconds() < hours*3600
    except (KeyError,ValueError,TypeError):return False


def main():
    now=dt.datetime.now(CN)
    path=ROOT/'data/qdii.json'
    old=json.loads(path.read_text()) if path.exists() else {}
    issues=[]
    history_path=ROOT/'data/qdii-history.json'
    full_history=json.loads(history_path.read_text()).get('funds',{}) if history_path.exists() else {}
    try:
        remote_history=json.loads(request(PUBLIC_URL.replace('qdii.json','qdii-history.json')))
        for code,points in remote_history.get('funds',{}).items():
            if points and (not full_history.get(code) or points[-1]['date']>=full_history[code][-1]['date']):full_history[code]=points
    except Exception:pass
    try:
        deployed=json.loads(request(PUBLIC_URL))
        if deployed.get('schemaVersion')==1:
            for code, fund in deployed.get('funds',{}).items():
                current=old.setdefault('funds',{}).setdefault(code,{})
                for key,stamp in [('quota','checkedAt'),('navData','fetchedAt')]:
                    incoming=fund.get(key)
                    if incoming and incoming.get(stamp,'')>current.get(key,{}).get(stamp,''):current[key]=incoming
                if fund.get('quotaHistory') and (not current.get('quotaHistory') or fund['quotaHistory'][-1]['at'] > current['quotaHistory'][-1]['at']):
                    current['quotaHistory']=fund['quotaHistory']
    except Exception:pass
    try:
        funds,excluded=catalog(request(CATALOG_URL));catalog_at=now.isoformat(timespec='seconds')
    except Exception as exc:
        issues.append('catalog: '+type(exc).__name__)
        funds={k:{p:v for p,v in f.items() if p not in ['quota','navData','quotaHistory']} for k,f in old.get('funds',{}).items()}
        excluded=old.get('excluded',[]);catalog_at=old.get('catalogCheckedAt')
        if not funds:raise RuntimeError('Fund discovery failed and no cached universe exists')
    try:trades=trade_rows(request(TRADE_URL))
    except Exception as exc:trades={};issues.append('purchaseTable: '+type(exc).__name__)
    jobs={}
    for code,fund in funds.items():
        previous=old.get('funds',{}).get(code,{})
        for key in ['quota','navData','quotaHistory']:
            if previous.get(key) is not None:fund[key]=previous[key]
        if not fund.get('quota',{}).get('verified') or not recent(fund.get('quota',{}),'checkedAt',now,1/6):
            jobs[(code,'quota')]=lambda f=fund:quota_page(request(f"https://fundf10.eastmoney.com/jjfl_{f['code']}.html"),f,now)
        if not recent(fund.get('navData',{}),'fetchedAt',now,6):
            jobs[(code,'navData')]=lambda c=code:nav_series(request(f'https://fund.eastmoney.com/pingzhongdata/{c}.js'),c,now)
    executor=concurrent.futures.ThreadPoolExecutor(max_workers=4)
    ordered=sorted(jobs.items(),key=lambda item:(item[0][1]!='quota',funds[item[0][0]].get(item[0][1],{}).get('checkedAt' if item[0][1]=='quota' else 'fetchedAt','')))
    futures={executor.submit(fn):key for key,fn in ordered}
    try:
        for future in concurrent.futures.as_completed(futures,timeout=300):
            code,field=futures[future]
            try:
                incoming=future.result()
                if field=='navData' and incoming['navDate'] < funds[code].get('navData',{}).get('navDate',''):
                    raise ValueError('Older NAV data cannot replace a newer NAV')
                funds[code][field]=incoming
            except Exception as exc:
                issues.append(f'{code}/{field}: {type(exc).__name__}')
                if field=='quota' and not funds[code].get('quota') and code in trades:
                    funds[code]['quota']=fallback_quota(trades[code],now)
    except concurrent.futures.TimeoutError:
        issues.append('collection deadline: retained cached data for unfinished requests')
    finally:
        for future in futures:
            if not future.done():future.cancel()
        executor.shutdown(wait=False,cancel_futures=True)
    for fund in funds.values():
        if fund.get('navData'):
            n=fund['navData']
            merged={p['date']:dict(date=p['date'],nav=p['nav']) for p in full_history.get(fund['code'],[])}
            merged.update({p['date']:dict(date=p['date'],nav=p['nav']) for p in n['history']})
            full_history[fund['code']]=[merged[d] for d in sorted(merged) if d<=n['navDate']][-252:]
            n['history']=full_history[fund['code']][-60:]
        fund['quotaHistory']=history_update(fund.get('quotaHistory'),fund.get('quota'))
    result=dict(schemaVersion=1,generatedAt=now.isoformat(timespec='seconds'),catalogCheckedAt=catalog_at,
        catalogSource=CATALOG_URL,channel='天天基金公开渠道',funds=funds,excluded=excluded,issues=issues)
    history_path.write_text(json.dumps(dict(generatedAt=result['generatedAt'],funds={code:full_history[code] for code in funds if code in full_history}),ensure_ascii=False,separators=(',',':'))+'\n')
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');temp.replace(path)
    print(json.dumps({'shares':len(funds),'indexShares':sum(f['category']=='index' for f in funds.values()),
        'quotaVerified':sum(bool(f.get('quota',{}).get('verified')) for f in funds.values()),
        'navSeries':sum(bool(f.get('navData')) for f in funds.values()),'issues':issues},ensure_ascii=False))

if __name__=='__main__':main()
