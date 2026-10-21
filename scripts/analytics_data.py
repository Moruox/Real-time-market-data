"""Closed-session price indicators and attributed official CSI valuation data."""
import concurrent.futures
import datetime as dt
import io
import json
import math
import re
import subprocess
from zoneinfo import ZoneInfo

CSI_BASE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/'


def download(url):
    return subprocess.check_output(['curl', '--fail', '--compressed', '-L', '--retry', '1',
        '--connect-timeout', '6', '--max-time', '18', '-sS', url, '-A', 'Mozilla/5.0'], stderr=subprocess.DEVNULL)


def positive(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (ValueError, TypeError):
        return None


def closed_cutoff(item, now):
    local = now.astimezone(ZoneInfo(item['zone']))
    close = dt.time.fromisoformat(item['closeAfter'])
    # A 15-minute buffer prevents partially published bars from entering indicators.
    return local.date() if local.time().replace(tzinfo=None) >= close else local.date() - dt.timedelta(days=1)


def technical(rows, item, now, source, url):
    cutoff = closed_cutoff(item, now).isoformat()
    clean = {}
    for row in rows:
        try:
            date = dt.date.fromisoformat(str(row[0])).isoformat()
            close = positive(row[1])
            if close and date <= cutoff:
                clean[date] = close
        except (ValueError, TypeError, IndexError):
            continue
    history = [{'date': d, 'close': v} for d, v in sorted(clean.items())][-252:]
    if len(history) < 15:
        raise ValueError('Insufficient closed-session history')
    values = [p['close'] for p in history]
    # Wilder RSI: initialize with 14 changes, then smooth the complete available sample.
    changes = [b - a for a, b in zip(values, values[1:])]
    gain = sum(max(0, x) for x in changes[:14]) / 14
    loss = sum(max(0, -x) for x in changes[:14]) / 14
    for change in changes[14:]:
        gain = (gain * 13 + max(0, change)) / 14
        loss = (loss * 13 + max(0, -change)) / 14
    rsi = 100 - 100 / (1 + gain / loss) if loss else 100 if gain else 50
    hi, lo, last = max(values), min(values), values[-1]
    ma = sum(values[-200:]) / 200 if len(values) >= 200 else None
    return dict(asOf=history[-1]['date'], sampleSize=len(history), close=last,
        ma200=ma, rsi14=rsi, high252=hi, low252=lo,
        drawdownPct=(last / hi - 1) * 100,
        distance200Pct=(last / ma - 1) * 100 if ma else None,
        pricePositionPct=(last - lo) / (hi - lo) * 100 if hi > lo else 50,
        history=history, source=source, url=url, fetchedAt=now.isoformat(timespec='seconds'))


def fetch_technical(item, now):
    if item.get('historyTencent'):
        code = item['historyTencent']
        url = f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,340,qfq'
        try:
            data = json.loads(download(url))['data'][code]
            rows = data.get('day') or data.get('qfqday') or []
            return technical([[r[0], r[2]] for r in rows], item, now, '腾讯财经日线', url)
        except (ValueError, KeyError, TypeError, subprocess.SubprocessError):
            if not item.get('eastmoney'):
                raise
    code = item['eastmoney']
    begin = (now.date() - dt.timedelta(days=550)).strftime('%Y%m%d')
    url = ('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + code +
        '&klt=101&fqt=0&lmt=340&beg=' + begin + '&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55')
    data = json.loads(download(url))['data']
    rows = [r.split(',') for r in data['klines']]
    return technical([[r[0], r[2]] for r in rows], item, now, '东方财富日线', url)


def valuation_rows(rows, code, now, url):
    """Read column names rather than assuming undocumented quote API PE fields."""
    headers = [str(x) for x in rows[0]]
    def column(label):
        return next(i for i, x in enumerate(headers) if label in x)
    ix = {k: column(v) for k, v in {'date':'日期', 'code':'指数代码', 'pe':'P/E1', 'pe2':'P/E2', 'yield':'D/P1'}.items()}
    valid = []
    for row in rows[1:]:
        try:
            date = dt.datetime.strptime(str(row[ix['date']]).split('.')[0], '%Y%m%d').date()
            actual_code = str(row[ix['code']]).split('.')[0].zfill(6)
            if date > now.date() or actual_code != code:
                continue
            valid.append((date, row))
        except (ValueError, TypeError, IndexError):
            continue
    if not valid:
        raise ValueError('No dated valuation matching index code')
    date, row = max(valid, key=lambda x: x[0])
    pe = positive(row[ix['pe']])
    if pe is None:
        raise ValueError('PE missing or not meaningful')
    return dict(date=date.isoformat(), pe=pe, pe2=positive(row[ix['pe2']]),
        dividendYield=positive(row[ix['yield']]), source='中证指数', url=url,
        method='PE1（总股本）；股息率1（总股本）', fetchedAt=now.isoformat(timespec='seconds'))


def fetch_valuation(item, now):
    import xlrd
    code = item['csindex']
    url = CSI_BASE + f'file/autofile/indicator/{code}indicator.xls'
    book = xlrd.open_workbook(file_contents=download(url))
    sheet = book.sheet_by_index(0)
    return valuation_rows([sheet.row_values(i) for i in range(sheet.nrows)], code, now, url)


def factsheet_text(text, code, now, url):
    dates = re.findall(r'(\d{4})年(\d{1,2})月(\d{1,2})日', text)
    if not dates or not re.search(r'\b' + re.escape(code) + r'\b', text):
        raise ValueError('Undated or mismatched factsheet')
    date = dt.date(*map(int, dates[0]))
    match = re.search(r'市净率\s+([\d.]+)', text)
    pb = positive(match.group(1)) if match else None
    if date > now.date():
        raise ValueError('Future factsheet')
    return dict(date=date.isoformat(), pb=pb, unavailableReason='官方单张未披露PB' if pb is None else None, source='中证指数月度单张', url=url,
        method='计算用股本口径', fetchedAt=now.isoformat(timespec='seconds'))


def fetch_factsheet(item, now):
    from pypdf import PdfReader
    code = item['csindex']
    url = CSI_BASE + f'indices/detail/files/zh_CN/{code}factsheet.pdf'
    reader = PdfReader(io.BytesIO(download(url)))
    text = reader.pages[0].extract_text(extraction_mode='layout')
    return factsheet_text(text, code, now, url)


def update_analysis(items, old, now):
    analysis = {i['id']: dict(old.get(i['id'], {})) for i in items if i.get('analyze')}
    jobs, errors = {}, []
    for item in items:
        if not item.get('analyze'):
            continue
        for field, fn, hours in [('technical', fetch_technical, 4), ('valuation', fetch_valuation, 24), ('factsheet', fetch_factsheet, 24)]:
            if field != 'technical' and not item.get('csindex'):
                continue
            current = analysis[item['id']].get(field, {})
            try:
                age = (now - dt.datetime.fromisoformat(current['fetchedAt'])).total_seconds()
                if 0 <= age < hours * 3600:
                    continue
            except (ValueError, KeyError, TypeError):
                pass
            jobs[(item['id'], field)] = lambda i=item, f=fn: f(i, now)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fn): key for key, fn in jobs.items()}
        for future in concurrent.futures.as_completed(futures):
            key, field = futures[future]
            try:
                result = future.result()
                date_key = 'asOf' if field == 'technical' else 'date'
                if result[date_key] >= analysis[key].get(field, {}).get(date_key, ''):
                    analysis[key][field] = result
            except Exception as exc:
                errors.append(f'{key}/{field}: {type(exc).__name__}')
    return analysis, errors
