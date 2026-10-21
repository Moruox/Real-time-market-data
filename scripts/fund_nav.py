"""Reconstruct an approximate reinvested NAV index from published daily returns.

Never use raw NAV or cumulative NAV as a fallback for adjusted-return signals.
The source return is rounded; this is a research reconstruction, not official NAV.
"""
import datetime as dt
import math
from zoneinfo import ZoneInfo
from scripts.analytics_data import technical

METHOD = 'published-daily-return-chain-v1'
CN = ZoneInfo('Asia/Shanghai')


def finite(value):
    if isinstance(value, bool):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def adjusted_nav(rows, code, now):
    url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
    result = dict(version=1, method=METHOD, source='天天基金已公布日增长率连乘重建',
        url=url, fetchedAt=now.isoformat(timespec='seconds'), status='insufficient',
        reason='至少需要252个连续有效净值观测日', sampleSize=0, history=[])
    dates = {}
    for row in rows:
        try:
            date = dt.datetime.fromtimestamp(float(row['x']) / 1000, CN).date()
        except (KeyError, ValueError, TypeError, OverflowError):
            result.update(status='unavailable', reason='源数据存在无法定位日期的记录，暂停复权计算')
            return result
        if date > now.date():
            continue
        point = dict(date=date.isoformat(), nav=finite(row.get('y')),
            change=finite(row.get('equityReturn')), event=str(row.get('unitMoney') or ''))
        if point['date'] in dates and dates[point['date']] != point:
            result.update(status='unavailable', reason='同一净值日存在冲突记录')
            return result
        dates[point['date']] = point
    chain, previous, boundary = [], None, ''
    for date, point in sorted(dates.items()):
        value, change = point['nav'], point['change']
        if value is None or value <= 0:
            chain, previous, boundary = [], None, '存在无效净值记录'
            continue
        valid = previous is not None and change is not None and -100 < change <= 100
        if valid:
            days = (dt.date.fromisoformat(date)-dt.date.fromisoformat(previous['date'])).days
            raw_change = (value/previous['nav']-1)*100
            event = point['event']
            if days > 14:
                valid, boundary = False, '净值观测中断超过14个自然日'
            elif event:
                # Distribution metadata can omit the cash amount. Trust the reported
                # adjusted daily return only when the raw ex-event decline differs.
                if not any(word in event for word in ['分红', '拆分', '折算']):
                    valid, boundary = False, '存在未识别的份额事件'
                elif abs(raw_change-change) <= 0.05:
                    valid, boundary = False, '分红或拆分日的增长率调整口径无法确认'
            elif abs(raw_change-change) > 0.05:
                valid, boundary = False, '净值变动与日增长率不一致且缺少份额事件说明'
        elif previous is not None:
            boundary = '日增长率缺失或异常，未按零涨幅填充'
        if valid:
            next_value = chain[-1]['value'] * (1 + change/100)
            if not math.isfinite(next_value) or next_value <= 0:
                valid, boundary = False, '复权连乘结果异常'
        if not valid:
            chain = [dict(date=date, value=100.0)]
        else:
            chain.append(dict(date=date, value=next_value))
        # Keep only the last window and renormalize to avoid overflow over decades.
        if len(chain) > 252:
            chain = chain[-252:]
        base = chain[0]['value']
        if base != 100:
            chain = [dict(date=p['date'], value=p['value']/base*100) for p in chain]
        previous = point
    if not chain:
        result.update(status='unavailable', reason=boundary or '暂无有效净值日增长率')
        return result
    result.update(asOf=chain[-1]['date'], sampleSize=len(chain),
        history=[dict(date=p['date'], value=round(p['value'], 8)) for p in chain])
    if len(chain) >= 15:
        # NAVs are published observations rather than exchange sessions; midnight
        # cutoff includes today's NAV only when the source has actually published it.
        t = technical([[p['date'],p['value']] for p in chain],
            dict(zone='Asia/Shanghai',closeAfter='00:00'), now, result['source'], url)
        t.pop('history', None)
        result['technical'] = t
    if len(chain) >= 252:
        result.update(status='ready', reason='以源站含份额事件调整的日增长率连乘；取最近252个有效净值日')
    elif boundary:
        result['reason'] = f'{boundary}；中断后仅{len(chain)}个有效净值日，不跨断点拼接'
    return result
