export const CN = 'Asia/Shanghai';
export const chnDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: CN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export const cnTime = value => new Intl.DateTimeFormat('en-GB', { timeZone: CN, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value));
export function validQuote(q) {
  return Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.changePct) && Math.abs(q.changePct) <= 1000 && Number.isFinite(Date.parse(q.quoteAt)) && Date.parse(q.quoteAt) <= Date.now() + 300000;
}
// Convert a source wall-clock timestamp to UTC without assuming a fixed US DST offset.
export function zonedISO(wall, zone) {
  const p = wall.match(/\d+/g).map(Number);
  const naive = Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0, p[5] || 0);
  let result = naive;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(result));
    const o = Object.fromEntries(parts.map(x => [x.type, x.value]));
    const shown = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    result += naive - shown;
  }
  return new Date(result).toISOString();
}
export function parseTencent(text, instruments, fetchedAt = new Date().toISOString()) {
  const values = Object.fromEntries([...text.matchAll(/v_([\w.]+)="([^"]*)";/g)].map(m => [m[1], m[2]]));
  const quotes = {};
  for (const item of instruments) {
    if (!item.tencent || !values[item.tencent]) continue;
    try {
      let price, changePct, quoteAt;
      if (item.tencent.startsWith('hf_')) {
        const a = values[item.tencent].split(',');
        price = Number(a[0]); changePct = (price / Number(a[7]) - 1) * 100;
        quoteAt = zonedISO(`${a[12]} ${a[6]}`, CN);
      } else {
        const a = values[item.tencent].split('~');
        price = Number(a[3]); changePct = a[32] === '' ? NaN : Number(a[32]);
        const d = a[30].length === 14 ? a[30].replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6') : a[30].replaceAll('/', '-');
        quoteAt = zonedISO(d, item.tencent.startsWith('us') ? 'America/New_York' : CN);
      }
      const q = { price, changePct, quoteAt, fetchedAt, source: '腾讯财经', basis: '较前收盘' };
      if (validQuote(q)) quotes[item.id] = q;
    } catch { /* A malformed row must not erase the other quotes. */ }
  }
  return quotes;
}
export function parseEastmoney(data, instruments, fetchedAt = new Date().toISOString()) {
  const values = Object.fromEntries((data?.data?.diff || []).map(v => [`${v.f13}.${v.f12}`.toLowerCase(), v]));
  const quotes = {};
  for (const item of instruments) {
    const a = values[item.eastmoney?.toLowerCase()];
    if (!a || a.f2 === '-' || a.f3 === '-' || a.f124 === '-') continue;
    const q = { price: Number(a.f2), changePct: Number(a.f3), quoteAt: new Date(Number(a.f124) * 1000).toISOString(), fetchedAt, source: '东方财富', basis: ['bonds', 'futures'].includes(item.group) || ['gc', 'au'].includes(item.id) ? '较昨结算（源站口径）' : '较前收盘' };
    if (validQuote(q)) quotes[item.id] = q;
  }
  return quotes;
}
export function mergeQuotes(current, incoming) {
  let updated = 0;
  for (const [id, q] of Object.entries(incoming)) {
    if (!validQuote(q)) continue;
    if (!current[id] || Date.parse(q.quoteAt) >= Date.parse(current[id].quoteAt)) {
      current[id] = { ...q }; updated++;
    }
  }
  return updated;
}
