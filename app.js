import { CN, chnDate, cnTime, parseTencent, parseEastmoney, mergeQuotes } from './quotes.js';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
const price = (v, digits = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const moneyClass = (v, arrow = true) => `<span class="pct ${tone(v)}">${arrow ? `<span aria-hidden="true">${v > 0 ? '↗' : v < 0 ? '↘' : '—'}</span>` : ''}${signed(v)}</span>`;
const state = { config: null, quotes: {}, funds: {}, snapshotAt: null, active: 'all', sort: 0, search: '', busy: false, countdown: 30, lastRefresh: null };
let watch;
try { const raw = localStorage.getItem('market-watch'); watch = raw ? new Set(JSON.parse(raw)) : new Set(['nq', 'kospi', 'tl', 'xau']); } catch { watch = new Set(['nq', 'kospi', 'tl', 'xau']); }
let auto = true;
try { auto = localStorage.getItem('market-auto') !== 'false'; } catch {}
$('#auto').checked = auto;
function meta(id) { return state.config.instruments.find(x => x.id === id); }
function ageMinutes(stamp) { return Math.max(0, Math.floor((Date.now() - Date.parse(stamp)) / 60000)); }
function quoteLabel(item, q) {
  const prior = chnDate(q.quoteAt) !== chnDate(Date.now());
  const age = ageMinutes(q.quoteAt);
  const oldFetch = ageMinutes(q.fetchedAt) >= 10;
  if (prior) return { text: '非今日报价', warning: true };
  if (item.group === 'us') return { text: age > 30 ? '最近正常时段' : '正常时段报价', warning: false };
  if (age >= 20) return { text: `距今${age < 60 ? `${age}分钟` : `${Math.floor(age / 60)}小时${age % 60}分`}`, warning: true };
  if (oldFetch) return { text: '缓存报价', warning: true };
  return { text: q.source, warning: false };
}
function highlight(id, name, symbol) {
  const item = meta(id), q = state.quotes[id];
  if (!q) return `<article class="highlight"><div class="highlight-top"><span class="highlight-title">${name}</span><span class="highlight-symbol">${symbol}</span></div><div class="highlight-price">—</div><div class="highlight-bottom"><span class="muted small">暂未取得报价</span></div></article>`;
  const label = quoteLabel(item, q);
  return `<article class="highlight"><div class="highlight-top"><a class="highlight-title" href="${item.url}" target="_blank" rel="noopener noreferrer">${name} ↗</a><span class="highlight-symbol">${symbol}</span></div><div class="highlight-price">${price(q.price, item.digits)}<small>${esc(item.unit)}</small></div><div class="highlight-bottom">${moneyClass(q.changePct)}<span class="highlight-time" title="${esc(q.basis)}">${chnDate(q.quoteAt).slice(5)} ${cnTime(q.quoteAt).slice(0, 5)}${label.warning ? ' · 较早报价' : ''}</span></div></article>`;
}
function renderHighlights() {
  $('#highlights').innerHTML = highlight('nq', '纳斯达克100期货', 'NQ') + highlight('kospi', '韩国KOSPI', 'KS11') + highlight('tl', '30年期国债', 'TL') + highlight('xau', '现货黄金', 'XAU/USD');
}
function row(item) {
  const q = state.quotes[item.id];
  const star = `<td class="star-cell"><button class="star" data-watch="${item.id}" aria-label="${watch.has(item.id) ? '取消关注' : '关注'}${item.name}" aria-pressed="${watch.has(item.id)}">${watch.has(item.id) ? '★' : '☆'}</button></td>`;
  const name = `<td class="name-cell"><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.name}</a><span class="symbol">${item.symbol}</span></td>`;
  if (!q) return `<tr class="market-row">${star}${name}<td class="num price">—</td><td class="num"><span class="muted">—</span></td><td class="quote-time"><span class="source warning">暂无有效报价</span></td></tr>`;
  const label = quoteLabel(item, q);
  const stamp = `${chnDate(q.quoteAt).slice(5)} ${cnTime(q.quoteAt)}`;
  return `<tr class="market-row">${star}${name}<td class="num price" title="单位：${item.unit}">${price(q.price, item.digits)}</td><td class="num" title="${esc(q.basis)}">${moneyClass(q.changePct)}</td><td class="quote-time" title="${esc(q.source)} · ${esc(q.basis)} · 查询于${cnTime(q.fetchedAt)}"><time class="time-primary" datetime="${esc(q.quoteAt)}">${stamp}</time><span class="source ${label.warning ? 'warning' : ''}">${esc(label.text)}</span></td></tr>`;
}
function renderMarkets() {
  const { instruments, groups } = state.config;
  let filtered = instruments.filter(i => (state.active === 'all' || (state.active === 'watch' ? watch.has(i.id) : i.group === state.active)) && `${i.name} ${i.symbol} ${i.id}`.toLowerCase().includes(state.search));
  let html = '';
  if (state.sort) {
    filtered = [...filtered].sort((a, b) => {
      const av = state.quotes[a.id]?.changePct, bv = state.quotes[b.id]?.changePct;
      if (av == null) return 1; if (bv == null) return -1; return state.sort * (av - bv);
    });
    html = filtered.map(row).join('');
  } else {
    for (const group of groups) {
      const items = filtered.filter(i => i.group === group.id);
      if (!items.length) continue;
      const note = group.id === 'us' ? '现货正常时段 · 不是期货' : group.id === 'bonds' ? '源站涨跌口径通常为较昨结算' : group.id === 'futures' ? '当月连续 · 不代表今晚收盘' : '';
      html += `<tr class="group-heading"><th colspan="5" scope="colgroup">${group.label}<small>${note}</small></th></tr>` + items.map(row).join('');
    }
  }
  $('#market-body').innerHTML = html || '<tr><td colspan="5" class="empty">没有匹配的行情。试试其他名称，或点击 ☆ 添加关注。</td></tr>';
  $('#table-count').textContent = `${filtered.length} 个行情`;
  $('#watch-count').textContent = watch.size;
  $('#sort-indicator').textContent = state.sort === 1 ? '↑' : state.sort === -1 ? '↓' : '↕';
  $('#sort').setAttribute('aria-label', `按涨跌幅排序，当前${state.sort === 1 ? '升序' : state.sort === -1 ? '降序' : '默认顺序'}`);
}
function renderSidebar() {
  const stocks = state.config.instruments.filter(i => ['cn', 'asia'].includes(i.group) && state.quotes[i.id]).map(i => ({ ...i, q: state.quotes[i.id] }));
  const up = stocks.filter(i => i.q.changePct > 0).length, down = stocks.filter(i => i.q.changePct < 0).length, flat = stocks.length - up - down;
  $('#breadth').innerHTML = `<span style="flex:${up || .01};background:var(--up)"></span><span style="flex:${flat || .01};background:var(--subtle)"></span><span style="flex:${down || .01};background:var(--down)"></span>`;
  $('#breadth-labels').innerHTML = `<span class="up"><b>${up}</b>上涨</span><span class="muted"><b>${flat}</b>平盘</span><span class="down"><b>${down}</b>下跌</span>`;
  const sorted = [...stocks].sort((a, b) => b.q.changePct - a.q.changePct);
  const mover = (i, label) => i ? `<div class="mover"><div><small>${label}</small>${i.name}</div><strong class="${tone(i.q.changePct)}">${signed(i.q.changePct)}</strong></div>` : '';
  $('#movers').innerHTML = mover(sorted[0], '当前涨幅最高') + mover(sorted.at(-1), '当前涨幅最低');
  const ids = ['nq', 'kospi', 'hsi', 'tl', 'xau'];
  const scale = Math.max(1, ...ids.map(id => Math.abs(state.quotes[id]?.changePct || 0)));
  $('#comparison').innerHTML = ids.map(id => {
    const item = meta(id), q = state.quotes[id]; if (!q) return '';
    const width = Math.abs(q.changePct) / scale * 48;
    return `<div class="compare-row"><div class="compare-label"><span>${item.name}</span><b class="${tone(q.changePct)}">${signed(q.changePct)}</b></div><div class="bar-track" title="${item.name} ${signed(q.changePct)}"><span class="bar-fill ${tone(q.changePct)}" style="width:${width}%;left:${q.changePct < 0 ? 50 - width : 50}%"></span></div></div>`;
  }).join('');
}
function fundChart(history, name) {
  if (!history?.length || history.length < 2) return '<p class="small muted">暂无历史净值</p>';
  const lo = Math.min(...history.map(x => x.value)), hi = Math.max(...history.map(x => x.value)), span = hi - lo || 1;
  const points = history.map((p, i) => `${(i / (history.length - 1) * 300).toFixed(2)},${(52 - (p.value - lo) / span * 44).toFixed(2)}`).join(' ');
  const ret = (history.at(-1).value / history[0].value - 1) * 100;
  return `<svg class="fund-chart" viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="${name}从${history[0].date}至${history.at(-1).date}，含分红再投累计回报${signed(ret)}"><line x1="0" y1="55" x2="300" y2="55"/><polyline points="${points}"/></svg>`;
}
function renderFunds() {
  $('#fund-grid').innerHTML = state.config.funds.map(f => {
    const q = state.funds[f.id];
    return `<article class="fund-card"><h3><a href="https://fund.eastmoney.com/${f.id}.html" target="_blank" rel="noopener noreferrer">${f.name} ↗</a></h3><div class="fund-code">${f.id} <span> / </span> ${f.type}</div>${q ? `<div class="fund-values"><div><span class="value-label">单位净值 · 元</span><strong class="fund-nav">${price(q.nav, 4)}</strong></div><div class="num"><span class="value-label">当日回报 · 含分红</span><strong class="fund-pct ${tone(q.changePct)}">${signed(q.changePct)}</strong></div></div>${fundChart(q.history, f.name)}<div class="fund-footer"><span>近${q.history?.length || 0}个估值日 · 含分红</span><span>净值日期 ${q.navDate}</span></div>` : '<div class="empty">暂无已公布净值</div>'}</article>`;
  }).join('');
}
function render() { if (!state.config) return; renderHighlights(); renderMarkets(); renderSidebar(); renderFunds(); }
async function get(url, encoding) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (encoding) return new TextDecoder(encoding).decode(await r.arrayBuffer());
    return await r.json();
  } finally { clearTimeout(timeout); }
}
async function snapshot() {
  const data = await get(`./data/quotes.json?t=${Date.now()}`);
  if (data.schemaVersion !== 1 || !data.quotes) throw new Error('Invalid snapshot');
  mergeQuotes(state.quotes, data.quotes);
  for (const [id, q] of Object.entries(data.funds || {})) {
    if (!Number.isFinite(q.nav) || !Number.isFinite(q.changePct) || !/^\d{4}-\d{2}-\d{2}$/.test(q.navDate)) continue;
    if (!state.funds[id] || q.navDate >= state.funds[id].navDate) state.funds[id] = q;
  }
  state.snapshotAt = data.generatedAt;
  $('#snapshot-info').textContent = `仓库快照生成于 ${chnDate(data.generatedAt)} ${cnTime(data.generatedAt)}（北京时间）。页面直连报价可能比快照更新。`;
  render();
  return true;
}
async function refresh() {
  if (state.busy || !state.config) return;
  state.busy = true; $('#refresh').disabled = true; $('#refresh').classList.add('busy');
  $('#refresh span').textContent = '正在刷新';
  const items = state.config.instruments;
  const tc = items.filter(i => i.tencent).map(i => i.tencent).join(',');
  const emItems = items.filter(i => i.eastmoney);
  const emURL = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12,f13,f14,f124&secids=';
  const tasks = [snapshot()];
  let direct = 0;
  tasks.push(get(`https://qt.gtimg.cn/q=${tc}&_=${Date.now()}`, 'gb18030').then(text => {
    const parsed = parseTencent(text, items); if (!Object.keys(parsed).length) throw new Error('Empty Tencent data');
    direct += mergeQuotes(state.quotes, parsed); render();
  }));
  // Independent small batches avoid one market's endpoint failure blocking everything.
  for (const group of [emItems.filter(i => i.group === 'asia'), emItems.filter(i => i.group !== 'asia')]) {
    tasks.push(get(emURL + group.map(i => i.eastmoney).join(',') + `&_=${Date.now()}`).then(data => {
      const parsed = parseEastmoney(data, group); if (!Object.keys(parsed).length) throw new Error('Empty Eastmoney data');
      direct += mergeQuotes(state.quotes, parsed); render();
    }));
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter(r => r.status === 'rejected').length;
  state.lastRefresh = new Date(); state.countdown = state.config.refreshSeconds;
  const received = Object.keys(state.quotes).length;
  $('#status').innerHTML = `<span class="dot ${direct ? '' : 'dim'}"></span>${cnTime(state.lastRefresh)} 查询 · ${direct ? `${direct}项直连有效` : '使用最后有效快照'} · 共${received}/${items.length}项`;
  const alert = $('#alert');
  if (!received) { alert.textContent = '暂时无法连接行情源。请稍后重试，或点击数据源链接查看。'; alert.hidden = false; }
  else if (failed) { alert.textContent = `部分数据源暂时不可用，已保留最后有效报价。每行时间代表实际报价时间，不是本次查询时间。`; alert.hidden = false; }
  else { alert.hidden = true; }
  render();
  state.busy = false; $('#refresh').disabled = false; $('#refresh').classList.remove('busy'); $('#refresh span').textContent = '刷新行情';
}
function tick() {
  const now = new Date(); $('#clock').textContent = cnTime(now);
  $('#today').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: CN, month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  if (!state.config) return;
  if ($('#auto').checked && !state.busy && !document.hidden) {
    state.countdown--;
    if (state.countdown <= 0) refresh();
  }
  $('#countdown').textContent = $('#auto').checked ? `${Math.max(0, state.countdown)}s` : '暂停';
}
$('#refresh').addEventListener('click', refresh);
$('#auto').addEventListener('change', e => { try { localStorage.setItem('market-auto', String(e.target.checked)); } catch {} state.countdown = state.config?.refreshSeconds || 30; tick(); });
$('#theme').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('market-theme', theme); } catch {} updateThemeLabel(); });
function updateThemeLabel() { $('#theme').setAttribute('aria-label', `切换${document.documentElement.dataset.theme === 'dark' ? '亮色' : '深色'}主题`); }
$('#tabs').addEventListener('click', e => { const button = e.target.closest('button[data-group]'); if (!button) return; state.active = button.dataset.group; for (const b of $('#tabs').querySelectorAll('button')) { const active = b === button; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); } renderMarkets(); });
$('#search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); renderMarkets(); });
$('#sort').addEventListener('click', () => { state.sort = state.sort === 0 ? -1 : state.sort === -1 ? 1 : 0; renderMarkets(); });
$('#market-body').addEventListener('click', e => {
  const b = e.target.closest('button[data-watch]'); if (!b) return;
  const id = b.dataset.watch;
  if (watch.has(id)) watch.delete(id); else watch.add(id);
  try { localStorage.setItem('market-watch', JSON.stringify([...watch])); } catch {}
  renderMarkets();
  $('#status').setAttribute('aria-label', `${b.getAttribute('aria-label')}成功`);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#auto').checked && state.config && state.lastRefresh && Date.now() - state.lastRefresh > 30000) refresh(); });
updateThemeLabel(); tick(); setInterval(tick, 1000);
try {
  state.config = await get('./config.json');
  if (!Array.isArray(state.config.instruments) || !state.config.instruments.length) throw new Error('Invalid config');
  const validIds = new Set(state.config.instruments.map(i => i.id)); watch = new Set([...watch].filter(id => validIds.has(id)));
  $('#tabs').insertAdjacentHTML('beforeend', state.config.groups.map(g => `<button data-group="${esc(g.id)}" aria-pressed="false">${esc(g.label)}</button>`).join(''));
  render(); await refresh();
} catch {
  $('#alert').hidden = false; $('#alert').textContent = '页面配置载入失败。请检查网络后刷新页面。';
  $('#status').textContent = '未连接'; $('#highlights').innerHTML = ''; $('#market-body').innerHTML = '<tr><td colspan="5" class="empty">暂时无法载入行情</td></tr>';
}
