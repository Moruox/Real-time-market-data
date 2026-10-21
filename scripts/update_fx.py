"""Dated ECB reference FX rates crossed into CNY; never bank execution prices."""
import datetime as dt
import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
CN=ZoneInfo('Asia/Shanghai')
SOURCE='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
PAGE='https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'
PUBLIC='https://moruox.github.io/Real-time-market-data/data/fx.json'
NAMES={'USD':'美元','EUR':'欧元','HKD':'港元','JPY':'日元','KRW':'韩元','GBP':'英镑','SGD':'新加坡元','AUD':'澳大利亚元','CAD':'加拿大元','CHF':'瑞士法郎','NZD':'新西兰元','THB':'泰铢','MYR':'马来西亚林吉特','INR':'印度卢比','IDR':'印尼盾','PHP':'菲律宾比索','CZK':'捷克克朗','DKK':'丹麦克朗','HUF':'匈牙利福林','PLN':'波兰兹罗提','RON':'罗马尼亚列伊','SEK':'瑞典克朗','ISK':'冰岛克朗','NOK':'挪威克朗','TRY':'土耳其里拉','BRL':'巴西雷亚尔','ILS':'以色列新谢克尔','MXN':'墨西哥比索','ZAR':'南非兰特'}


def download(url):
    return subprocess.check_output(['curl','--fail','--compressed','-L','-sS','--connect-timeout','6','--max-time','45','--retry','1',url],stderr=subprocess.DEVNULL)


def positive(value):
    try:
        v=float(value)
        return v if math.isfinite(v) and v>0 else None
    except (ValueError,TypeError):return None


def parse_ecb(xml,now):
    days={}
    for node in ET.fromstring(xml).iter():
        if not node.get('time'):continue
        try:date=dt.date.fromisoformat(node.get('time'))
        except ValueError:continue
        if date>now.date() or date<now.date()-dt.timedelta(days=400):continue
        rates={n.get('currency'):positive(n.get('rate')) for n in node if n.get('currency')}
        if not rates.get('CNY') or not rates.get('USD'):continue
        rates['EUR']=1.0
        if date.isoformat() in days and days[date.isoformat()]!=rates:raise ValueError('Conflicting date')
        days[date.isoformat()]=rates
    if not days:raise ValueError('No valid dated CNY reference observations')
    latest=max(days)
    currencies={}
    for code,name in NAMES.items():
        if not days[latest].get(code):continue
        history=[dict(date=date,cnyPerUnit=round(rates['CNY']/rates[code],10)) for date,rates in sorted(days.items()) if rates.get(code)]
        if not history:continue
        currencies[code]=dict(code=code,name=name,history=history)
    if 'USD' not in currencies:raise ValueError('USD reference missing')
    return dict(schemaVersion=1,generatedAt=now.isoformat(timespec='seconds'),checkedAt=now.isoformat(timespec='seconds'),
        asOf=latest,source='欧洲央行 ECB 日参考汇率',url=PAGE,dataUrl=SOURCE,base='CNY',
        method='同一参考日的 EUR/CNY 与 EUR/外币交叉计算；日参考价，非银行成交价',currencies=currencies,issues=[])


def main():
    now=dt.datetime.now(CN);path=ROOT/'data/fx.json'
    old=json.loads(path.read_text()) if path.exists() else {}
    try:
        deployed=json.loads(download(PUBLIC))
        if deployed.get('schemaVersion')==1 and deployed.get('asOf','')>=old.get('asOf','') and deployed.get('checkedAt','')>old.get('checkedAt',''):old=deployed
    except Exception:pass
    try:
        age=(now-dt.datetime.fromisoformat(old['checkedAt'])).total_seconds()
    except (KeyError,ValueError):age=999999
    if 0<=age<3600:
        result=old
    else:
        try:
            result=parse_ecb(download(SOURCE),now)
            if result['asOf']<old.get('asOf',''):raise ValueError('Older source data')
        except Exception as exc:
            if not old:raise
            result=dict(old,issues=['本次更新失败，保留上次参考价：'+type(exc).__name__])
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');temp.replace(path)
    print(json.dumps(dict(currencies=len(result['currencies']),asOf=result['asOf'],issues=result['issues']),ensure_ascii=False))

if __name__=='__main__':main()
