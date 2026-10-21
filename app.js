import { esc, price, signed, tone, sparkline } from './ui.js?v=terminal-7';
import { createQDII } from './qdii.js?v=terminal-7';
import { assess, validValuation, RULES } from './analysis.js?v=terminal-7';
import { CN, chnDate, cnTime, parseTencent, parseEastmoney, mergeQuotes } from './quotes.js?v=terminal-7';
const $ = s => document.querySelector(s);
const moneyClass = (v, arrow = true) => `<span class="pct ${tone(v)}">${arrow ? `<span aria-hidden="true">${v > 0 ? '↗' : v < 0 ? '↘' : '—'}</span>` : ''}${signed(v)}</span>`;
const state = { config: null, quotes: {}, analysis: {}, page: 'market', snapshotAt: null, active: 'all', sort: 0, search: '', busy: false, countdown: 30, lastRefresh: null, quoteWarning: '' };
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
  const q=state.quotes[item.id],a=state.analysis[item.id] || {},t=a.technical,v=a.valuation,pb=a.factsheet;
  const star=`<td class="star-cell"><button class="star" data-watch="${item.id}" aria-label="${watch.has(item.id)?'取消关注':'关注'}${item.name}" aria-pressed="${watch.has(item.id)}">${watch.has(item.id)?'★':'☆'}</button></td>`;
  const name=`<td class="name-cell"><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.name}</a><span class="symbol">${item.symbol}</span></td>`;
  const label=q?quoteLabel(item,q):null;
  const valuation=item.assetType==='goldETF'?'<span class="muted">不适用</span><span class="metric-sub">黄金无PE / PB</span>':validValuation(v)?`<span class="pe-value">${price(v.pe)}<small> / ${pb?.pb>0?price(pb.pb):'—'}</small></span><span class="metric-sub">PE ${esc(v.date.slice(5))}${pb?.pb>0?` · PB ${esc(pb.date.slice(5))}`:''}</span>`:`<span class="muted">—</span><span class="metric-sub">${item.analyze?'估值暂缺':'不适用'}</span>`;
  const signal=item.analyze?`<button class="signal-button" data-analyze="${item.id}" aria-label="查看${item.name}的估值与买点分析">${signalHTML(t)}</button>`:'<span class="muted">—</span>';
  const time=q?`<time class="time-primary" datetime="${esc(q.quoteAt)}">${chnDate(q.quoteAt).slice(5)} ${cnTime(q.quoteAt)}</time><span class="source ${label.warning?'warning':''}">${esc(label.text)}</span>`:'<span class="source warning">暂无有效报价</span>';
  return `<tr class="market-row">${star}${name}<td class="num price-cell" data-label="最新价"><strong class="price">${q?price(q.price,item.digits):'—'}</strong></td><td class="num change-cell" data-label="涨跌幅" title="${esc(q?.basis)}">${q?moneyClass(q.changePct):'—'}</td><td class="trend-cell" data-label="近60日走势">${t?sparkline(t.history,'close',item.name+'近60日收盘走势'): '<span class="muted">—</span>'}</td><td class="num valuation-cell" data-label="PE1 / PB">${valuation}</td><td class="num drawdown-cell" data-label="高点回撤" title="近252交易日收盘高点回撤，不是估值分位">${t?`<strong>${signed(t.drawdownPct)}</strong><span class="metric-sub">收盘 ${esc(t.asOf.slice(5))}</span>`:'<span class="muted">—</span>'}</td><td class="signal-cell" data-label="买点参考">${signal}</td><td class="quote-time">${time}${item.analyze?`<button class="detail-link" data-analyze="${item.id}">分析详情 ↗</button>`:''}</td></tr>`;
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
      html += `<tr class="group-heading"><th colspan="9" scope="colgroup">${group.label}<small>${note}</small></th></tr>` + items.map(row).join('');
    }
  }
  $('#market-body').innerHTML = html || '<tr><td colspan="9" class="empty">没有匹配的行情。试试其他名称，或点击 ☆ 添加关注。</td></tr>';
  $('#table-count').textContent = `${filtered.length} 项行情`;
  const analyzable = instruments.filter(i => i.analyze);
  const covered = analyzable.filter(i => validValuation(state.analysis[i.id]?.valuation));
  $('#analysis-count').textContent = `${analyzable.length}个指数 · ${covered.length}个有官方PE`;
  $('#watch-count').textContent = watch.size;
  $('#sort-indicator').textContent = state.sort === 1 ? '↑' : state.sort === -1 ? '↓' : '↕';
  $('#sort').setAttribute('aria-label', `按涨跌幅排序，当前${state.sort === 1 ? '升序' : state.sort === -1 ? '降序' : '默认顺序'}`);
}
function renderSidebar() {
  const stocks = state.config.instruments.filter(i => ['cn', 'asia', 'europe', 'us'].includes(i.group) && i.analyze && state.quotes[i.id]).map(i => ({ ...i, q: state.quotes[i.id] }));
  const up = stocks.filter(i => i.q.changePct > 0).length, down = stocks.filter(i => i.q.changePct < 0).length, flat = stocks.length - up - down;
  $('#breadth').innerHTML = `<span style="flex:${up || .01};background:var(--up)"></span><span style="flex:${flat || .01};background:var(--subtle)"></span><span style="flex:${down || .01};background:var(--down)"></span>`;
  $('#breadth-labels').innerHTML = `<span class="up"><b>${up}</b>上涨</span><span class="muted"><b>${flat}</b>平盘</span><span class="down"><b>${down}</b>下跌</span>`;
  const sorted = [...stocks].sort((a, b) => b.q.changePct - a.q.changePct);
  const mover = (i, label) => i ? `<div class="mover"><div><small>${label}</small>${i.name}</div><strong class="${tone(i.q.changePct)}">${signed(i.q.changePct)}</strong></div>` : '';
  $('#movers').innerHTML = mover(sorted[0], '最近报价涨幅最高') + mover(sorted.at(-1), '最近报价涨幅最低');
  const ids = ['nq', 'kospi', 'hsi', 'tl', 'xau'];
  const scale = Math.max(1, ...ids.map(id => Math.abs(state.quotes[id]?.changePct || 0)));
  $('#comparison').innerHTML = ids.map(id => {
    const item = meta(id), q = state.quotes[id]; if (!q) return '';
    const width = Math.abs(q.changePct) / scale * 48;
    return `<div class="compare-row"><div class="compare-label"><span>${item.name}</span><b class="${tone(q.changePct)}">${signed(q.changePct)}</b></div><div class="bar-track" title="${item.name} ${signed(q.changePct)}"><span class="bar-fill ${tone(q.changePct)}" style="width:${width}%;left:${q.changePct < 0 ? 50 - width : 50}%"></span></div></div>`;
  }).join('');
}
function signalHTML(t) {
  const s = assess(t);
  return `<span class="signal signal-${s.key}">${s.label}</span>`;
}
const qdii=createQDII({get,showDialog,showAnalysis});
function render() { if (!state.config) return; renderHighlights(); renderMarkets(); renderSidebar(); qdii.setMarkets(state.quotes,state.analysis); }
function setPage(page, updateHash=false) {
  state.page=page==='qdii'?'qdii':'market';
  const isQDII=state.page==='qdii';
  $('#market-page').hidden=isQDII;$('#qdii-page').hidden=!isQDII;
  $('#alert').hidden=isQDII||!state.quoteWarning;
  $('.skip').setAttribute('href',isQDII?'#quota-title':'#main');
  for(const b of document.querySelectorAll('[data-page]')){const active=b.dataset.page===state.page;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  $('#page-title').innerHTML=isQDII?'场外QDII<span>限额雷达</span>':'全球市场<span>终端</span>';
  $('#page-subtitle').textContent=isQDII?'按指数与投资方向筛选场外QDII，查看限额、走势、标的估值与买点参考。':'行情 · 估值 · 买入参考，在一张表里看清。';
  if(updateHash && location.hash!==(isQDII?'#qdii':'#market'))history.pushState(null,'',isQDII?'#qdii':'#market');
  if(isQDII)qdii.refresh();
}

function seriesChart(t, name, isETF=false) {
  const rows = t?.history;
  if (!Array.isArray(rows) || rows.length < 2) return '';
  const lo = Math.min(...rows.map(p => p.close)), hi = Math.max(...rows.map(p => p.close)), span = hi - lo || 1;
  const points = rows.map((p, i) => `${(i / (rows.length - 1) * 660).toFixed(1)},${(134 - (p.close - lo) / span * 124).toFixed(1)}`).join(' ');
  return `<div class="history-chart"><div><h3>近${rows.length}个交易日</h3><span>${isETF?'ETF日线 · 源站价格口径':'价格指数 · 不含分红再投'}</span></div><svg viewBox="0 0 660 145" role="img" aria-label="${esc(name)}近${rows.length}个交易日收盘走势"><line x1="0" y1="140" x2="660" y2="140"/><polyline points="${points}"/></svg><div class="chart-dates"><span>${esc(rows[0].date)}</span><span>${esc(rows.at(-1).date)}</span></div></div>`;
}
function metric(label, value, note) { return `<div class="analysis-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`; }
function sourceLink(url, label) { return /^https:\/\//.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label); }
function showDialog(title, kicker, content) {
  $('#dialog-title').textContent = title; $('#dialog-kicker').textContent = kicker;
  $('#dialog-content').innerHTML = content;
  $('#analysis-dialog').showModal();
}
function showAnalysis(id) {
  const item = meta(id); if (!item?.analyze) return;
  const a = state.analysis[id] || {}, v = validValuation(a.valuation) ? a.valuation : null;
  const t = a.technical, pb = a.factsheet, s = assess(t);
  const dated = v ? `${esc(v.date)} · 总股本口径` : '暂无可靠同口径数据';
  const valuation = metric('市盈率 PE1', v ? `${price(v.pe)}<small>倍</small>` : '—', dated) +
    metric('市净率 PB', pb?.pb > 0 ? `${price(pb.pb)}<small>倍</small>` : '—', pb?.pb > 0 ? `${esc(pb.date)} · 月度计算用股本口径` : '暂无可靠同口径数据') +
    metric('股息率1', v?.dividendYield > 0 ? `${price(v.dividendYield)}<small>%</small>` : '—', dated);
  const tech = t ? metric(`距近${t.sampleSize}日收盘高点`, `${signed(t.drawdownPct)}`, `高点 ${price(t.high252)}`) +
    metric('相对200日均线', Number.isFinite(t.distance200Pct) ? signed(t.distance200Pct) : '—', Number.isFinite(t.ma200) ? `均线 ${price(t.ma200)}` : '日线不足200个交易日') +
    metric('RSI · 14日', price(t.rsi14, 1), '0—100 · 越高近期涨势越强') : '<p class="muted">暂未取得足够的收盘日线。</p>';
  showDialog(item.name, 'VALUATION & BUYING REFERENCE', `
    <p class="dialog-symbol">${esc(item.symbol)} · ${sourceLink(item.url, '源站行情')}</p>
    ${item.assetType==='goldETF'?'<h3 class="dialog-section-title">黄金价格参考</h3><p class="inline-note">黄金不产生企业利润，PE、PB与股息率不适用。下面是518880自身已收盘价格的回撤、均线、RSI与区间位置，不是黄金内在价值估算或估值分位。场内ETF成交价还可能偏离基金净值；当前没有同步IOPV，因此不估算实时折溢价。</p>':`<h3 class="dialog-section-title">基本面估值</h3><div class="metrics-grid">${valuation}</div><p class="inline-note">PE1和PB的日期、股本口径可能不同。缺少长期同口径PE序列，暂不提供历史估值分位；低PE也不等于一定低估。</p>`}
    <div class="signal-summary">${signalHTML(t)}<p>${esc(s.description)}</p></div>
    <h3 class="dialog-section-title">买点参考 · ${t ? esc(t.asOf) + ' 已收盘' : '等待收盘数据'}</h3><div class="metrics-grid">${tech}</div>
    ${t ? `<div class="position-line"><div><span>近${t.sampleSize}日价格位置</span><strong>${price(t.pricePositionPct, 1)}%</strong></div><progress max="100" value="${Math.min(100, Math.max(0, t.pricePositionPct))}" aria-label="近252日价格位置"></progress><p>按区间最低与最高收盘价计算，属于价格位置，不是估值分位。</p></div>` : ''}
    ${seriesChart(t, item.name, item.assetType==='goldETF')}
    <details class="rules-details"><summary>查看判断规则与适用范围</summary>${rulesContent()}</details>
    <div class="analysis-sources">${item.assetType==='goldETF'?'':v ? sourceLink(v.url, `PE / 股息率：${v.source} ${v.date}`) : '<span>PE / 股息率：暂无可靠数据</span>'}${item.assetType==='goldETF'?'':pb ? sourceLink(pb.url, `${pb.pb > 0 ? 'PB' : '月度单张未披露PB'}：${pb.source} ${pb.date}`) : '<span>PB：暂无可靠数据</span>'}${t ? sourceLink(t.url, `日线：${t.source} · 收盘截至 ${t.asOf}`) : ''}</div>`);
}
function rulesContent() {
  return `<p class="inline-note">面向长期、小额分批研究，按下列顺序匹配第一项。判断只使用已收盘日线，不预测底部、次日涨跌或收益；估值单独展示，不混入未经验证的综合分数。</p><ol class="rules-list">${RULES.map(([name, text]) => `<li><strong>${name}</strong><span>${text}</span></li>`).join('')}</ol><p class="inline-note">至少252个有效交易日才判断；日线超过14个自然日暂停判断。200日均线为简单平均，RSI14采用Wilder平滑。价格指标基于对应指数或ETF的日线，ETF以源站价格口径为准；不作跨币种换算；QDII还受汇率、费用和跟踪误差影响。规则未经收益优化回测，“回撤观察”并非确定买点。</p>`;
}

async function get(url, encoding, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
  for (const [id, a] of Object.entries(data.analysis || {})) {
    const current = state.analysis[id] ||= {};
    for (const field of ['technical', 'valuation', 'factsheet']) {
      const next = a[field]; if (!next) continue;
      const dateKey = field === 'technical' ? 'asOf' : 'date';
      if (!current[field] || next[dateKey] >= current[field][dateKey]) current[field] = next;
    }
  }
  state.snapshotAt = data.generatedAt;
  $('#snapshot-info').textContent = `仓库快照生成于 ${chnDate(data.generatedAt)} ${cnTime(data.generatedAt)} · 北京时间。估值与收盘指标随快照更新。`;
  render();
  return true;
}
async function refresh(forceQDII=false) {
  if (state.busy || !state.config) return;
  state.busy = true; $('#refresh').disabled = true; $('#refresh').classList.add('busy');
  $('#refresh span').textContent = '正在刷新';
  const items = state.config.instruments;
  const tc = items.filter(i => i.tencent).map(i => i.tencent).join(',');
  const emItems = items.filter(i => i.eastmoney);
  const emURL = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12,f13,f14,f124&secids=';
  const tasks = [snapshot()];
  if(state.page==='qdii')tasks.push(qdii.refresh(forceQDII===true));
  let direct = 0;
  tasks.push(get(`https://qt.gtimg.cn/q=${tc}&_=${Date.now()}`, 'gb18030').then(text => {
    const parsed = parseTencent(text, items); if (!Object.keys(parsed).length) throw new Error('Empty Tencent data');
    direct += mergeQuotes(state.quotes, parsed); render();
  }));
  // Independent small batches avoid one market's endpoint failure blocking everything.
  for (const group of [emItems.filter(i => ['asia', 'europe', 'cn'].includes(i.group)), emItems.filter(i => !['asia', 'europe', 'cn'].includes(i.group))]) {
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
  state.quoteWarning=alert.hidden?'':alert.textContent;
  if(state.page==='qdii')alert.hidden=true;
  render();
  state.busy = false; $('#refresh').disabled = false; $('#refresh').classList.remove('busy'); $('#refresh span').textContent = '刷新数据';
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
$('#refresh').addEventListener('click', () => refresh(true));
$('#auto').addEventListener('change', e => { try { localStorage.setItem('market-auto', String(e.target.checked)); } catch {} state.countdown = state.config?.refreshSeconds || 30; tick(); });
$('#theme').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('market-theme', theme); } catch {} updateThemeLabel(); });
function updateThemeLabel() { $('#theme').setAttribute('aria-label', `切换${document.documentElement.dataset.theme === 'dark' ? '亮色' : '深色'}主题`); }
$('#tabs').addEventListener('click', e => { const button = e.target.closest('button[data-group]'); if (!button) return; state.active = button.dataset.group; for (const b of $('#tabs').querySelectorAll('button')) { const active = b === button; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); } renderMarkets(); });
$('#search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); renderMarkets(); });
$('#sort').addEventListener('click', () => { state.sort = state.sort === 0 ? -1 : state.sort === -1 ? 1 : 0; renderMarkets(); });
$('#market-body').addEventListener('click', e => {
  const detail = e.target.closest('button[data-analyze]'); if (detail) { showAnalysis(detail.dataset.analyze); return; }
  const b = e.target.closest('button[data-watch]'); if (!b) return;
  const id = b.dataset.watch;
  if (watch.has(id)) watch.delete(id); else watch.add(id);
  try { localStorage.setItem('market-watch', JSON.stringify([...watch])); } catch {}
  renderMarkets();
  $('#status').setAttribute('aria-label', `${b.getAttribute('aria-label')}成功`);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#auto').checked && state.config && state.lastRefresh && Date.now() - state.lastRefresh > 30000) refresh(); });
$('.nav [role="tablist"]').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)setPage(b.dataset.page,true);});
$('.nav [role="tablist"]').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const page=e.key==='Home'?'market':e.key==='End'?'qdii':state.page==='market'?'qdii':'market';setPage(page,true);document.querySelector(`[data-page="${page}"]`).focus();});
window.addEventListener('popstate',()=>setPage(['#qdii','#quota-title'].includes(location.hash)?'qdii':'market'));
$('#rules-open').addEventListener('click', () => showDialog('买点参考如何判断', 'TRANSPARENT RULES', rulesContent()));
$('#dialog-close').addEventListener('click', () => $('#analysis-dialog').close());
$('#analysis-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); } });
updateThemeLabel(); tick(); setInterval(tick, 1000);
try {
  state.config = await get('./config.json');
  if (!Array.isArray(state.config.instruments) || !state.config.instruments.length) throw new Error('Invalid config');
  const validIds = new Set(state.config.instruments.map(i => i.id)); watch = new Set([...watch].filter(id => validIds.has(id)));
  $('#tabs').insertAdjacentHTML('beforeend', state.config.groups.map(g => `<button data-group="${esc(g.id)}" aria-pressed="false">${esc(g.label)}</button>`).join(''));
  render(); setPage(['#qdii','#quota-title'].includes(location.hash)?'qdii':'market'); await refresh();
} catch {
  $('#alert').hidden = false; $('#alert').textContent = '页面配置载入失败。请检查网络后刷新页面。';
  $('#status').textContent = '未连接'; $('#highlights').innerHTML = ''; $('#market-body').innerHTML = '<tr><td colspan="9" class="empty">暂时无法载入行情</td></tr>';
}
