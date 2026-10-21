"""Public quote snapshot for a buildless GitHub Pages dashboard. No credentials."""
import concurrent.futures
import datetime as dt
import json
import math
import pathlib
import re
import subprocess
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
CN = ZoneInfo('Asia/Shanghai')
NY = ZoneInfo('America/New_York')


def iso(value, zone=CN):
    return value.replace(tzinfo=zone).isoformat()


def request(url, encoding='utf-8', referer='https://finance.sina.com.cn/'):
    raw = subprocess.check_output(['curl', '--fail', '--compressed', '-L', '--retry', '1',
        '--connect-timeout', '8', '--max-time', '20', '-sS', url,
        '-A', 'Mozilla/5.0', '-H', 'Referer: ' + referer], stderr=subprocess.DEVNULL)
    return raw.decode(encoding).lstrip('\ufeff')


def valid(price, pct):
    return all(math.isfinite(float(v)) for v in [price, pct]) and float(price) > 0 and abs(float(pct)) <= 1000


def record(price, pct, stamp, source, basis, fetched):
    if not valid(price, pct):
        raise ValueError('Invalid numeric quote')
    parsed = dt.datetime.fromisoformat(stamp)
    if parsed > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise ValueError('Future quote timestamp')
    return dict(price=float(price), changePct=float(pct), quoteAt=stamp,
                fetchedAt=fetched, source=source, basis=basis)


def tencent(text, items, fetched):
    values = dict(re.findall(r'v_([\w.]+)="([^"]*)";', text))
    quotes = {}
    for item in items:
        key = item.get('tencent')
        if key not in values:
            continue
        try:
            if key.startswith('hf_'):
                a = values[key].split(',')
                stamp = iso(dt.datetime.fromisoformat(a[12] + 'T' + a[6]))
                q = record(a[0], (float(a[0]) / float(a[7]) - 1) * 100, stamp, '腾讯财经', '较前收盘/源站基准', fetched)
            else:
                a = values[key].split('~')
                zone = NY if key.startswith('us') else CN
                date = a[30]
                parsed = dt.datetime.strptime(date, '%Y%m%d%H%M%S') if len(date) == 14 else dt.datetime.fromisoformat(date.replace('/', '-'))
                q = record(a[3], a[32], iso(parsed, zone), '腾讯财经', '较前收盘', fetched)
            quotes[item['id']] = q
        except (ValueError, IndexError, ZeroDivisionError):
            continue
    return quotes


def eastmoney(data, items, fetched):
    values = {(str(a.get('f13')) + '.' + a.get('f12', '')).lower(): a for a in (data.get('data') or {}).get('diff', [])}
    quotes = {}
    for item in items:
        a = values.get(item.get('eastmoney', '').lower())
        if not a:
            continue
        try:
            stamp = dt.datetime.fromtimestamp(int(a['f124']), CN).isoformat()
            basis = '较昨结算（源站口径）' if item['group'] in ['bonds', 'futures'] or item['id'] in ['gc', 'au'] else '较前收盘'
            quotes[item['id']] = record(a['f2'], a['f3'], stamp, '东方财富', basis, fetched)
        except (ValueError, TypeError, KeyError):
            continue
    return quotes


def sina(text, items, fetched):
    values = dict(re.findall(r'var hq_str_(\w+)="([^"]*)";', text))
    quotes = {}
    for item in items:
        key = item.get('sina')
        if key not in values:
            continue
        try:
            a = values[key].split(',')
            if key == 'nf_AU0':
                price, prev = float(a[8]), float(a[10])
                stamp = iso(dt.datetime.fromisoformat(a[17] + 'T' + a[1].zfill(6)[:2] + ':' + a[1].zfill(6)[2:4] + ':' + a[1].zfill(6)[4:]))
            elif key.startswith('nf_'):
                price, prev = float(a[3]), float(a[13])  # a[13] = previous settlement, not a[14] previous close
                stamp = iso(dt.datetime.fromisoformat(a[36] + 'T' + a[37]))
            elif key.startswith('hf_'):
                price, prev = float(a[0]), float(a[7])
                stamp = iso(dt.datetime.fromisoformat(a[12] + 'T' + a[6]))
            elif key.startswith('rt_'):
                price, prev = float(a[6]), float(a[3])
                stamp = iso(dt.datetime.fromisoformat(a[17].replace('/', '-') + 'T' + a[18]))
            else:
                price, prev = float(a[3]), float(a[2])
                stamp = iso(dt.datetime.fromisoformat(a[30] + 'T' + a[31]))
            basis = '较昨结算' if item['group'] in ['bonds', 'futures'] or item['id'] in ['gc', 'au'] else '较前收盘'
            quotes[item['id']] = record(price, (price / prev - 1) * 100, stamp, '新浪财经', basis, fetched)
        except (ValueError, IndexError, ZeroDivisionError):
            continue
    return quotes


def fund_data(text, code, fetched):
    m = re.search(r'var Data_netWorthTrend\s*=\s*(\[.*?\]);', text)
    am = re.search(r'var Data_ACWorthTrend\s*=\s*(\[.*?\]);', text)
    if not m or not am:
        raise ValueError('Fund NAV series missing')
    rows = json.loads(m.group(1))
    accumulated = dict(json.loads(am.group(1)))
    if len(rows) < 2:
        raise ValueError('Fund NAV series too short')
    history, total, prev = [], 1., None
    for v in rows:
        nav = float(v['y'])
        if prev:
            dividend = round((float(accumulated.get(v['x']) or nav) - nav) -
                (float(accumulated.get(prev['x']) or prev['y']) - float(prev['y'])), 7)
            if dividend < -0.00001:
                raise ValueError('Fund split requires explicit handling')
            total *= (nav + max(0, dividend)) / float(prev['y'])
        history.append({'date': dt.datetime.fromtimestamp(v['x'] / 1000, CN).date().isoformat(), 'value': total})
        prev = v
    latest = rows[-1]
    if not valid(latest['y'], latest['equityReturn']):
        raise ValueError('Invalid fund NAV')
    return dict(id=code, nav=float(latest['y']), changePct=float(latest['equityReturn']),
                navDate=history[-1]['date'], fetchedAt=fetched, source='天天基金', history=history[-60:])


def main():
    config = json.loads((ROOT / 'config.json').read_text())
    path = ROOT / 'data/quotes.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    quotes, funds = dict(old.get('quotes', {})), dict(old.get('funds', {}))
    fetched = dt.datetime.now(CN).isoformat(timespec='seconds')
    issues, successes = [], 0
    items = config['instruments']
    tc = ','.join(i['tencent'] for i in items if i.get('tencent'))
    em = ','.join(i['eastmoney'] for i in items if i.get('eastmoney'))
    jobs = {
        '腾讯财经': lambda: tencent(request('https://qt.gtimg.cn/q=' + tc, 'gb18030'), items, fetched),
        '东方财富': lambda: eastmoney(json.loads(request('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12,f13,f14,f124&secids=' + em)), items, fetched)
    }
    for fund in config['funds']:
        code = fund['id']
        jobs['fund:' + code] = lambda c=code: fund_data(request('https://fund.eastmoney.com/pingzhongdata/' + c + '.js', referer='https://fund.eastmoney.com/'), c, fetched)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        running = {executor.submit(fn): name for name, fn in jobs.items()}
        for future in concurrent.futures.as_completed(running):
            name = running[future]
            try:
                result = future.result()
                if name.startswith('fund:'):
                    code = name.split(':')[1]
                    if result['navDate'] >= funds.get(code, {}).get('navDate', ''):
                        funds[code] = result
                    successes += 1
                else:
                    for key, q in result.items():
                        if key not in quotes or dt.datetime.fromisoformat(q['quoteAt']) >= dt.datetime.fromisoformat(quotes[key]['quoteAt']):
                            quotes[key] = q
                    successes += bool(result)
            except Exception as exc:
                issues.append(name + ': ' + type(exc).__name__)
    missing = [i for i in items if i['id'] not in quotes or quotes[i['id']].get('fetchedAt') != fetched]
    missing = [i for i in missing if i.get('sina')]
    if missing:
        try:
            result = sina(request('https://hq.sinajs.cn/list=' + ','.join(i['sina'] for i in missing), 'gb18030'), missing, fetched)
            for key, q in result.items():
                if key not in quotes or dt.datetime.fromisoformat(q['quoteAt']) >= dt.datetime.fromisoformat(quotes[key]['quoteAt']):
                    quotes[key] = q
            successes += bool(result)
        except Exception as exc:
            issues.append('新浪备用: ' + type(exc).__name__)
    if not successes:
        raise RuntimeError('All data sources failed; leaving existing snapshot untouched')
    result = dict(schemaVersion=1, generatedAt=fetched, quotes=quotes, funds=funds, issues=issues)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(path)
    print(json.dumps({'generatedAt': fetched, 'quotes': len(quotes), 'funds': len(funds), 'issues': issues}, ensure_ascii=False))


if __name__ == '__main__':
    main()
