import {assess,validValuation} from './analysis.js?v=terminal-5';
import {esc,price,signed,tone,sparkline,historyPlot,bindHistoryPlot} from './ui.js?v=terminal-5';
import {chnDate,cnTime} from './quotes.js?v=terminal-5';
export function quotaState(fund,now=Date.now()) {
  const q=fund?.quota;
  if(!q)return {key:'unknown',label:'尚未核实',available:false,limit:'—',note:'缺少渠道数据'};
  const age=(now-Date.parse(q.checkedAt))/60000;
  if(!Number.isFinite(age)||age>120||age< -5)return {key:'stale',label:'状态待更新',available:false,limit:'待更新',note:'上次查询已超过2小时'};
  if(!q.verified)return {key:'unknown',label:'渠道待核实',available:false,limit:'待核实',note:'仅有备用状态表'};
  const raw=q.limitText || (q.dailyLimit>0&&q.limitUnit?`${price(q.dailyLimit,2)}${q.limitUnit}`:'');
  if(q.state==='paused')return {key:'paused',label:/封闭/.test(q.status)?'封闭期':'暂停申购',available:false,limit:'暂停',note:raw?`页面额度 ${raw}`:'当前不能普通申购'};
  if(q.dailyLimit>0&&Number.isFinite(q.minimum)&&q.minimum>q.dailyLimit)return {key:'unknown',label:'起点与限额冲突',available:false,limit:raw,note:'需到渠道确认'};
  if(q.state==='limited'&&!(q.dailyLimit>0)&&!q.unlimited)return {key:'unknown',label:'限额待核实',available:false,limit:'未披露',note:'状态为限制大额申购'};
  if(!['open','limited'].includes(q.state))return {key:'unknown',label:'状态待核实',available:false,limit:'—',note:q.status || ''};
  return {key:q.state,label:q.state==='limited'?'限额申购':'开放申购',available:true,limit:q.unlimited?'无限额':raw||'未披露',note:q.unlimited?'渠道页面未设限额':raw?'每账户每日 · 页面口径':'请到渠道确认金额'};
}
export function filterFunds(funds,{index='all',category='all',share='all',currency='all',onlyOpen=false,search=''}={},now=Date.now()) {
  const query=search.trim().toLowerCase();
  return funds.filter(f=>(index==='all'||f.index===index)&&(category==='all'||f.category===category)&&(currency==='all'||f.currency===currency)&&(share==='all'||(share==='other'?!['A','C'].includes(f.shareClass):f.shareClass===share))&&(!onlyOpen||quotaState(f,now).available)&&`${f.code} ${f.name} ${f.family}`.toLowerCase().includes(query));
}
export function fundInsight(f,analysis={},now=Date.now()) {
  if(!f.benchmark) {
    const applicable=f.category==='index'||f.category==='active';
    return {valuation:applicable?'估值暂缺':'PE / PB不适用',note:f.category==='index'?'暂无精确标的估值':f.category==='active'?'需穿透最新持仓':'债券、商品及多资产不套用股票估值',signal:{key:'missing',label:'暂不判断',description:'暂无适用且足够的标的数据，不使用未复权基金净值生成买点。'}};
  }
  const a=analysis[f.benchmark]||{},v=validValuation(a.valuation,now)?a.valuation:null,p=a.factsheet;
  const pe=v?`PE ${price(v.pe)}`:'PE —',pb=Number.isFinite(p?.pb)&&p.pb>0?`PB ${price(p.pb)}`:'PB —';
  return {valuation:v||p?.pb>0?`${pe} / ${pb}`:'估值暂缺',note:`标的指数${v?' · PE '+v.date:''}${p?.pb>0?' · PB '+p.date:''}`,signal:assess(a.technical,now),asOf:a.technical?.asOf,source:v?.url||v?.sourceUrl||p?.url};
}
export function createQDII({get,showDialog}) {
  const $=s=>document.querySelector(s);
  const state={data:null,index:'all',category:'all',share:'all',currency:'all',onlyOpen:false,search:'',sort:'available',page:1,size:24,busy:false,lastFetch:0,quotes:{},analysis:{},activeFund:null,range:90,fullHistory:null,historyPromise:null};
  if(window.matchMedia('(max-width:600px)').matches)$('#benchmark-fold').open=false;
  function setMarkets(quotes,analysis){state.quotes=quotes;state.analysis=analysis;renderBenchmarks();if(state.data)render();}
  function renderBenchmarks(){
    $('#qdii-benchmarks').innerHTML=[['ndx','纳斯达克100','NASDAQ 100'],['sp500','标普500','S&P 500']].map(([id,name,en])=>{
      const q=state.quotes[id],t=state.analysis[id]?.technical;
      return `<article class="panel benchmark-card"><div class="benchmark-head"><div><span class="section-kicker">${en}</span><h3>${name}</h3></div><span class="benchmark-tag">价格指数</span></div><div class="benchmark-content"><div><strong class="benchmark-price">${q?price(q.price):'—'}</strong><span class="benchmark-change ${tone(q?.changePct)}">${q?signed(q.changePct):'—'}</span><p>${q?`${chnDate(q.quoteAt).slice(5)} ${cnTime(q.quoteAt).slice(0,5)} · 北京时间`:'等待指数报价'}</p></div><div class="benchmark-spark">${t?sparkline(t.history,'close',name+'近252日收盘走势',252):''}<span>${t?`近252交易日 · 截至${t.asOf}`:'等待收盘日线'}</span></div></div></article>`;
    }).join('');
  }
  function renderOverview(){
    const funds=Object.values(state.data?.funds || {}),open=funds.filter(f=>quotaState(f).available).length;
    const metric=(label,value,note,cls='')=>`<article class="panel quota-metric ${cls}"><span>${label}</span><strong>${value}<small>个</small></strong><p>${note}</p></article>`;
    $('#quota-overview').innerHTML=metric('场外基金份额',funds.length,'目录中的海外基金 · 纯场内ETF除外')+metric('指数 / 投资方向',new Set(funds.map(f=>f.index)).size,'指数与主动、债券、商品分别归类')+metric('当前可普通申购',open,'已核实且未过期的渠道信息','metric-accent')+metric('可关联指数分析',funds.filter(f=>f.benchmark).length,'买点基于标的指数，不是基金净值预测');
  }
  function renderDirections(){
    const funds=Object.values(state.data?.funds||{}).filter(f=>state.category==='all'||f.category===state.category),groups=new Map();
    for(const f of funds){const g=groups.get(f.index)||{name:f.indexName,count:0};g.count++;groups.set(f.index,g);}
    if(state.index!=='all'&&!groups.has(state.index))state.index='all';
    $('#quota-direction').innerHTML='<option value="all">全部指数 / 方向</option>'+[...groups].sort((a,b)=>a[1].name.localeCompare(b[1].name,'zh-CN')).map(([id,g])=>`<option value="${esc(id)}">${esc(g.name)}（${g.count}）</option>`).join('');
    $('#quota-direction').value=state.index;
  }

  function renderRow(f){
    const info=fundInsight(f,state.analysis),q=f.quota,n=f.navData,v=quotaState(f),currency=f.currency==='USD'?'美元':'人民币';
    const nav=n?`<strong class="mono">${price(n.nav,4)}</strong><span class="metric-sub">${esc(n.navDate)}</span>`:'<span class="muted">暂无净值</span>';
    const tags=`<span class="fund-benchmark ${f.index==='sp500ew'?'variant':''}">${esc(f.indexName)}</span><span>${esc(f.shareClass==='未标注'?'类别未标注':f.shareClass+'类')}</span><span>${currency}</span>`;
    const minimum=q?.minimumText?esc(q.minimumText):'—';
    return `<tr class="fund-row"><td class="fund-name-cell"><button class="fund-name-button" data-fund="${f.code}" aria-label="查看${esc(f.name)}的限额与走势">${esc(f.name)}</button><span class="fund-code mono">${f.code}</span><div class="fund-tags">${tags}</div></td><td class="fund-status" data-label="渠道状态"><span class="quota-status status-${v.key}">${v.label}</span><span class="metric-sub">定投：${esc(q?.dcaStatus || '未核实')}</span></td><td class="num fund-limit" data-label="日申购限额"><strong class="limit-value ${v.available?'available':''}">${esc(v.limit)}</strong><span class="metric-sub">${esc(v.note)}</span></td><td class="num fund-minimum" data-label="申购起点"><span class="mono">${minimum}</span></td><td class="num fund-nav" data-label="单位净值">${nav}</td><td class="num fund-change" data-label="净值日涨跌"><span class="${tone(n?.changePct)} mono">${signed(n?.changePct)}</span></td><td class="fund-trend" data-label="近60个净值日">${n?sparkline(n.history,'nav',f.name+'单位净值走势',60):'<span class="muted">暂无曲线</span>'}</td><td class="fund-valuation" data-label="标的估值"><strong>${esc(info.valuation)}</strong><span class="metric-sub">${esc(info.note)}</span></td><td class="fund-signal" data-label="买点参考"><button class="signal signal-${info.signal.key}" data-fund="${f.code}" title="${esc(info.signal.description)}">${esc(info.signal.label)}</button><span class="metric-sub">${info.asOf?`指数收盘 ${esc(info.asOf)}`:esc(info.note)}</span></td><td class="fund-action"><button class="detail-link" data-fund="${f.code}" aria-label="查看${esc(f.code)}基金详情">限额 / 走势 ↗</button></td></tr>`;
  }
  function render(){
    if(!state.data)return;
    const all=Object.values(state.data.funds || {});let funds=filterFunds(all,state);
    funds.sort((a,b)=>{
      if(state.sort==='code')return a.code.localeCompare(b.code);
      const av=quotaState(a),bv=quotaState(b),rank=v=>v.available?0:v.key==='paused'?1:2;
      const priority=rank(av)-rank(bv);if(priority)return priority;
      if(state.sort==='limit'){
        const al=av.available?(a.quota.unlimited?Infinity:a.quota.dailyLimit||0):-1,bl=bv.available?(b.quota.unlimited?Infinity:b.quota.dailyLimit||0):-1;
        if(al!==bl)return bl-al;
      }
      if(a.currency!==b.currency)return a.currency==='CNY'?-1:1;
      return a.index.localeCompare(b.index)||a.family.localeCompare(b.family,'zh-CN')||a.code.localeCompare(b.code);
    });
    const pages=Math.max(1,Math.ceil(funds.length/state.size));state.page=Math.min(pages,state.page);
    $('#quota-body').innerHTML=funds.slice((state.page-1)*state.size,state.page*state.size).map(renderRow).join('')||'<tr><td colspan="10" class="empty">没有符合条件的份额。可切换币种、类别或取消“仅看可申购”。</td></tr>';
    $('#quota-count').textContent=`${funds.length} / ${all.length} 个份额 · ${new Set(funds.map(f=>f.family)).size}个系列`;
    $('#quota-page-number').textContent=`${state.page} / ${pages}`;$('#quota-prev').disabled=state.page<=1;$('#quota-next').disabled=state.page>=pages;
    $('#quota-stamp').textContent=`快照 ${chnDate(state.data.generatedAt)} ${cnTime(state.data.generatedAt)} · 北京时间`;
    const verified=all.filter(f=>f.quota?.verified).length,navCount=all.filter(f=>f.navData).length;
    $('#quota-coverage').textContent=`目录扫描 ${state.data.catalogCheckedAt?chnDate(state.data.catalogCheckedAt):'时间暂缺'} · 指数份额${all.filter(f=>f.category==='index').length}个 · 其他类型${all.filter(f=>f.category!=='index').length}个 · 渠道状态已核实${verified}/${all.length} · 净值曲线${navCount}/${all.length}。目录可能有遗漏、新发及已清盘记录；境外互认基金不属于本QDII目录。估值和买点关联精确标的，未匹配时不判断。`;

    renderOverview();
  }
  async function refresh(force=false){
    if(state.busy || (!force&&state.data&&Date.now()-state.lastFetch<300000))return true;
    state.busy=true;if(!state.data)$('#quota-body').innerHTML='<tr><td colspan="10" class="empty">正在读取基金限额和净值曲线…</td></tr>';$('#quota-reload').disabled=true;$('#quota-reload').textContent='读取中…';
    try{
      const data=await get(`./data/qdii.json?t=${Date.now()}`, undefined, 35000);
      if(data.schemaVersion!==1 || !data.funds || !Object.keys(data.funds).length)throw new Error('Invalid QDII data');
      if(!state.data || data.generatedAt>=state.data.generatedAt)state.data=data;
      state.lastFetch=Date.now();state.fullHistory=null;renderDirections();render();return true;
    }catch{
      if(!state.data)$('#quota-body').innerHTML='<tr><td colspan="10" class="empty">暂时无法读取基金快照。请点击“重新读取快照”重试。</td></tr>';
      $('#quota-coverage').textContent='快照读取失败，保留最后有效数据。请稍后重试。';return false;
    }finally{state.busy=false;$('#quota-reload').disabled=false;$('#quota-reload').textContent='重新读取快照 ↻';}
  }
  function loadFullHistory(){
    if(state.fullHistory)return Promise.resolve();
    if(!state.historyPromise)state.historyPromise=get(`./data/qdii-history.json?t=${Date.now()}`,undefined,60000).then(data=>{state.fullHistory=data.funds||{};}).finally(()=>{state.historyPromise=null;});
    return state.historyPromise;
  }
  function showFund(code,range=90){
    const f=state.data?.funds[code];if(!f)return;
    state.activeFund=code;state.range=range;
    const q=f.quota,n=f.navData,v=quotaState(f),unit=f.currency==='USD'?'美元':'人民币';
    const metric=(label,value,note)=>`<div class="analysis-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
    const info=fundInsight(f,state.analysis);
    let rows=state.fullHistory?.[code]||n?.history || [];
    if(rows.length&&n&&rows.at(-1).date!==n.navDate)rows=n.history;
    if(!state.fullHistory&&!state.historyPromise)loadFullHistory().then(()=>{if(state.activeFund===code&&$('#analysis-dialog').open&&$('#dialog-title').textContent===f.name)showFund(code,state.range);}).catch(()=>{const el=$('#full-history-status');if(el)el.textContent='全年曲线暂未加载，当前显示已缓存区间。';});
    if(rows.length){const cutoff=Date.parse(rows.at(-1).date)-range*86400000;rows=rows.filter(p=>Date.parse(p.date)>=cutoff);}
    const ranges=[30,90,365].map(days=>`<button data-fund-range="${days}" class="${days===range?'selected':''}" aria-pressed="${days===range}">${days===365?'近1年':days===90?'近3月':'近1月'}</button>`).join('');
    const perf=n?.performance || {};
    const fees=q?.fees;
    const feeText=fees&&[fees.management,fees.custody,fees.service].every(Number.isFinite)?`${price(fees.management+fees.custody+fees.service,2)}%`:'—';
    const history=(f.quotaHistory || []).slice(-12).reverse();
    const historyHTML=history.length?`<ol class="quota-history">${history.map(p=>`<li><time>${esc(p.at.slice(0,16).replace('T',' '))}</time><span class="history-point"></span><div><strong>${esc(p.status)}</strong><span>${esc(p.limitText || '限额未披露')}${p.state==='paused'?' · 暂停优先，非当前可买额度':''}</span></div></li>`).join('')}</ol>`:'<p class="muted small">尚无已核实的额度记录。</p>';
    const content=`<p class="dialog-symbol">${f.code} · ${esc(f.indexName)} · ${esc(f.shareClass)} · ${unit}</p><div class="fund-detail-status"><span class="quota-status status-${v.key}">${v.label}</span><span>${q?`渠道查询 ${esc(q.checkedAt.slice(0,16).replace('T',' '))} · 北京时间`:'渠道数据暂缺'}</span></div><div class="metrics-grid">${metric('当前普通申购',esc(v.limit),esc(v.note))}${metric('申购起点',esc(q?.minimumText || '—'),'页面原文金额，不跨币种换算')}${metric('本基金年费率合计',feeText,'管理 / 托管 / 销售服务费，非全部费用')}</div><p class="inline-note">${q?`源站申购状态：${esc(q.status)}；定投状态：${esc(q.dcaStatus)}。`:''}同系列不同份额可能共用额度；请以实际购买渠道的当次下单提示为准。</p><div class="signal-summary"><span class="signal signal-${info.signal.key}">${esc(info.signal.label)}</span><div><strong>${esc(info.valuation)}</strong><p>${esc(info.note)}${info.asOf?` · 指数收盘 ${esc(info.asOf)}`:""}。${esc(info.signal.description)} 指数参考不包含本基金汇率、费用、跟踪误差；买点条件与估值独立，不代表低估。</p></div></div><div class="fund-chart-heading"><div><h3>单位净值走势</h3><span>${n?`净值 ${price(n.nav,4)} ${unit} · ${esc(n.navDate)}`:'尚未公布或暂未取得净值'}</span></div><div class="range-switch" role="group" aria-label="净值走势时间范围">${ranges}</div></div><p class="inline-note" id="full-history-status">${state.fullHistory?"":"正在按需加载完整一年曲线；先展示近期缓存。"}</p>${rows.length>=2?historyPlot(rows,'nav',f.name+'单位净值走势',4):'<div class="chart-empty">暂无足够的历史净值，不使用其他份额代替。</div>'}<p class="inline-note">单位净值曲线未作分红复权。下列收益率为源站公布口径，日期截至${esc(n?.navDate || '—')}，不从未复权净值曲线直接推算。</p><div class="performance-grid">${[['近1月','1m'],['近3月','3m'],['近6月','6m'],['近1年','1y']].map(([label,key])=>`<div><span>${label}</span><strong class="${tone(perf[key])}">${signed(perf[key])}</strong></div>`).join('')}</div><details class="rules-details"><summary>查看额度变更与日度记录（${f.quotaHistory?.length || 0}条）</summary><p class="inline-note">自本页上线起，按实际观测记录变更；未变更时每天留一条。首次观测不代表当天才生效，也不补造历史额度。</p>${historyHTML}</details><div class="analysis-sources">${info.source?`<a href="${esc(info.source)}" target="_blank" rel="noopener noreferrer">标的指数估值来源 ↗</a>`:""}${q?`<a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">限额来源：${esc(q.source)} ↗</a>`:''}<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">基金详情与公告 ↗</a>${n?`<a href="https://fundf10.eastmoney.com/jjjz_${f.code}.html" target="_blank" rel="noopener noreferrer">已公布净值：天天基金 · ${esc(n.navDate)} ↗</a>`:''}</div>`;
    if($('#analysis-dialog').open){$('#dialog-title').textContent=f.name;$('#dialog-content').innerHTML=content;}else showDialog(f.name,'OTC QDII / QUOTA & NAV',content);
    if(rows.length>=2)bindHistoryPlot($('#dialog-content'),rows);
  }
  $('#quota-index-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;state.category=b.dataset.category;state.index="all";renderDirections();state.page=1;for(const x of $('#quota-index-tabs').querySelectorAll('button')){const active=x===b;x.classList.toggle('selected',active);x.setAttribute('aria-pressed',String(active));}render();});
  for(const [id,field] of [['quota-direction','index'],['quota-class','share'],['quota-currency','currency'],['quota-sort','sort']])$('#'+id).addEventListener('change',e=>{state[field]=e.target.value;state.page=1;render();});
  $('#quota-search').addEventListener('input',e=>{state.search=e.target.value;state.page=1;render();});
  $('#quota-only-open').addEventListener('change',e=>{state.onlyOpen=e.target.checked;state.page=1;render();});
  $('#quota-prev').addEventListener('click',()=>{state.page--;render();});$('#quota-next').addEventListener('click',()=>{state.page++;render();});
  $('#quota-body').addEventListener('click',e=>{const b=e.target.closest('[data-fund]');if(b)showFund(b.dataset.fund);});
  $('#dialog-content').addEventListener('click',e=>{const b=e.target.closest('[data-fund-range]');if(b&&state.activeFund){const range=Number(b.dataset.fundRange);showFund(state.activeFund,range);$('#dialog-content').querySelector(`[data-fund-range="${range}"]`).focus();}});
  $('#quota-reload').addEventListener('click',()=>refresh(true));
  return {refresh,setMarkets};
}
