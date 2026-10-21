import {esc,price,signed,tone,sparkline,historyPlot,bindHistoryPlot} from './ui.js?v=terminal-9';
import {chnDate,cnTime} from './quotes.js?v=terminal-9';
export const TROY_OUNCE_GRAMS=31.1034768;
const valid=n=>Number.isFinite(n)&&n>0;
export function compareFX(history,period=30){
  const rows=(history||[]).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&valid(p.cnyPerUnit)).sort((a,b)=>a.date.localeCompare(b.date));
  const current=rows.at(-1);if(!current)return null;
  let previous;
  if(Number(period)===1)previous=rows.at(-2);
  else{
    const target=Date.parse(current.date)-Number(period)*86400000;
    previous=rows.filter(p=>Date.parse(p.date)<=target&&Date.parse(p.date)>=target-10*86400000).at(-1);
  }
  return {current,previous:previous||null,rmbChangePct:previous?(previous.cnyPerUnit/current.cnyPerUnit-1)*100:null,assetFXPct:previous?(current.cnyPerUnit/previous.cnyPerUnit-1)*100:null};
}
export function convertAmount(amount,cnyPerUnit,direction='out'){
  if(!Number.isFinite(amount)||amount<0||!valid(cnyPerUnit))return null;
  return direction==='out'?amount/cnyPerUnit:direction==='in'?amount*cnyPerUnit:null;
}
export function goldFX(usdPerOunce,currentRate,previousRate){
  if(![usdPerOunce,currentRate,previousRate].every(valid))return null;
  const current=usdPerOunce*currentRate/TROY_OUNCE_GRAMS,previous=usdPerOunce*previousRate/TROY_OUNCE_GRAMS;
  return {current,previous,difference:current-previous,saving:previous-current};
}
export function translatedReturn(assetReturnPct,currentRate,previousRate){
  return Number.isFinite(assetReturnPct)&&assetReturnPct>=-100&&valid(currentRate)&&valid(previousRate)?((1+assetReturnPct/100)*(currentRate/previousRate)-1)*100:null;
}
const directionText=v=>!Number.isFinite(v)?'比较数据不足':Math.abs(v)<.005?'基本持平':v>0?'人民币升值':'人民币贬值';
const powerClass=v=>v>.005?'fx-strong':v<-.005?'fx-weak':'muted';
export function createFX({get}){
  const $=s=>document.querySelector(s);
  const state={data:null,period:30,currency:'USD',search:'',busy:false,lastFetch:0,quotes:{}};
  function comparison(code=state.currency){return compareFX(state.data?.currencies?.[code]?.history,state.period);}
  function metric(label,value,note){return `<article class="panel fx-metric"><span>${label}</span><strong>${value}</strong><p>${note}</p></article>`;}
  function setMarkets(quotes){state.quotes=quotes;if($('#fx-gold-live').checked&&valid(quotes.xau?.price))$('#fx-gold-usd').value=quotes.xau.price;renderGold();}
  function renderOverview(){
    const c=comparison('USD');const all=Object.values(state.data.currencies).map(f=>comparison(f.code));
    $('#fx-overview').innerHTML=metric('1美元折合人民币',c?price(c.current.cnyPerUnit,4)+'<small>元</small>':'—',`日参考价 · ${esc(state.data.asOf)}`)+metric('人民币对美元',c?`<span class="${powerClass(c.rmbChangePct)}">${signed(c.rmbChangePct)}</span>`:'—',c?`${directionText(c.rmbChangePct)} · ${esc(c.previous?.date||'缺少比较日')} → ${esc(c.current.date)}`:'数据暂缺')+metric('对多少种货币升值',all.filter(x=>x?.rmbChangePct>.005).length+'<small> / '+all.length+'</small>','按所选区间比较，不代表整体利好')+metric('100元能换美元',c?price(100/c.current.cnyPerUnit,2)+'<small>USD</small>':'—','同一参考日交叉汇率 · 不含银行点差');
  }
  function renderConverter(){
    const c=comparison(),f=state.data?.currencies[state.currency];if(!c||!f)return;
    const amount=$('#fx-amount').valueAsNumber,direction=$('#fx-direction').value;
    const current=convertAmount(amount,c.current.cnyPerUnit,direction),previous=c.previous?convertAmount(amount,c.previous.cnyPerUnit,direction):null;
    const from=direction==='out'?'人民币':f.name,to=direction==='out'?f.name:'人民币';
    $('#fx-amount-label').textContent=`输入${from}金额`;
    $('#fx-conversion-result').innerHTML=`<span>按 ${esc(c.current.date)} 参考价可换</span><strong>${current===null?'请输入有效金额':price(current,2)} <small>${esc(to)}</small></strong><p>${current===null?'输入金额后显示区间对比。':previous===null?'比较期数据不足':`同样金额按 ${esc(c.previous.date)} 的汇率可换 ${price(previous,2)} ${esc(to)}；现在${current>=previous?'多':'少'} ${price(Math.abs(current-previous),2)} ${esc(to)}。`}</p>`;
    const change=c.rmbChangePct,strong=change>.005,weak=change<-.005;
    const pro=strong?`人民币买${f.name}更省：当地价格不变时，赴当地旅游、留学、进口或偿还${f.name}债务的人民币成本下降。`:weak?`已有${f.name}资产或收入，换回人民币的金额增加；对以该币种收款的出口业务，汇率端可能更有利。`:'区间汇率变化很小，单独由汇率带来的影响有限。';
    const con=strong?`已持有、未对冲的${f.name}资产折回人民币会受拖累；以该币种收款的收入换回人民币减少。`:weak?`人民币兑换${f.name}变贵：旅游、留学、进口及该币种债务偿还成本上升。`:'资产本身涨跌、价格与费用仍可能主导最终结果。';
    $('#fx-impact').innerHTML=`<span class="section-kicker">WHAT IT MEANS FOR YOU</span><h3>${esc(f.name)} · <span class="${powerClass(change)}">${directionText(change)} ${signed(change)}</span></h3><p class="fx-compare-dates">${esc(c.previous?.date||'比较日暂缺')} → ${esc(c.current.date)}</p>${c.previous?`<div class="fx-benefit"><b>相对有利</b><p>${esc(pro)}</p></div><div class="fx-cost"><b>相对不利</b><p>${esc(con)}</p></div>`:'<p>没有足够的区间数据，暂不判断利好或利空。</p>'}<p class="inline-note">以上固定外币价格、资产表现及其他条件，只分析汇率这一项；升值或贬值都不等于全面利好。</p>`;
    const r=$('#fx-asset-return').valueAsNumber,total=c.previous?translatedReturn(r,c.current.cnyPerUnit,c.previous.cnyPerUnit):null;
    $('#fx-asset-result').innerHTML=total===null?'请输入有效涨跌幅，并选择有比较数据的区间。':`若${esc(f.name)}计价资产同期涨跌 <b>${signed(r)}</b>，汇率本身贡献 <b>${signed(c.assetFXPct)}</b>，未对冲的人民币折算收益约为 <strong class="${tone(total)}">${signed(total)}</strong>。<span>例如比较期投入10,000元，忽略申赎费用，期末约 ${price(10000*(1+total/100),2)} 元。</span>`;
  }
  function renderChart(){
    const f=state.data?.currencies[state.currency];if(!f)return;
    const cutoff=Date.parse(f.history.at(-1).date)-Math.max(30,Number(state.period))*86400000;
    const rows=f.history.filter(p=>Date.parse(p.date)>=cutoff).map(p=>({date:p.date,power:1/p.cnyPerUnit}));
    $('#fx-chart-title').textContent=`1元人民币能换多少${f.name}`;
    $('#fx-chart').innerHTML=rows.length>=2?historyPlot(rows,'power',`人民币兑换${f.name}`,state.currency==='IDR'||state.currency==='KRW'?2:4):'<p class="muted">暂无足够曲线。</p>';
    if(rows.length>=2)bindHistoryPlot($('#fx-chart'),rows);
  }
  function renderGold(){
    const c=comparison('USD'),q=state.quotes.xau,usd=$('#fx-gold-usd').valueAsNumber,budget=$('#fx-gold-budget').valueAsNumber;
    const g=c?.previous?goldFX(usd,c.current.cnyPerUnit,c.previous.cnyPerUnit):null;
    const live=$('#fx-gold-live').checked;
    $('#fx-gold-usd').readOnly=live;
    $('#fx-gold-source').textContent=live?(q?`国际现货黄金 ${q.source} · ${chnDate(q.quoteAt)} ${cnTime(q.quoteAt)} 北京时间${Date.now()-Date.parse(q.quoteAt)>1800000?' · 较早报价':''}`:'等待国际现货黄金报价，可取消勾选后输入假设金价'):'自定义假设金价；以下不是实际成交价格';
    if(!g){$('#fx-gold-results').innerHTML='<p class="inline-note">等待美元参考汇率与有效金价；缺少比较日时不推算。</p>';return;}
    const grams=Number.isFinite(budget)&&budget>=0?budget/g.current:null,oldGrams=Number.isFinite(budget)&&budget>=0?budget/g.previous:null;
    $('#fx-gold-results').innerHTML=`<div class="fx-gold-grid"><div><span>同一金价 × 比较期汇率</span><strong>${price(g.previous,2)}<small>元 / 克</small></strong><p>${esc(c.previous.date)} · 1美元 = ${price(c.previous.cnyPerUnit,4)}元</p></div><div class="fx-gold-now"><span>同一金价 × 最新参考汇率</span><strong>${price(g.current,2)}<small>元 / 克</small></strong><p>${esc(c.current.date)} · 1美元 = ${price(c.current.cnyPerUnit,4)}元</p></div><div><span>仅由汇率变化造成</span><strong class="${g.saving>=0?'fx-strong':'fx-weak'}">${g.saving>=0?'便宜':'贵了'} ${price(Math.abs(g.saving),2)}<small>元 / 克</small></strong><p>美元金价固定 ${price(usd,2)} 美元 / 金衡盎司</p></div></div><p class="fx-gold-budget">${grams===null?'请输入有效预算。':`${price(budget,2)}元预算，理论上可买 <b>${price(grams,3)}克</b>；比较期汇率下为 ${price(oldGrams,3)}克，相差 ${price(Math.abs(grams-oldGrams),3)}克。`}</p>`;
  }
  function renderTable(){
    if(!state.data)return;
    const query=state.search.toLowerCase(),funds=Object.values(state.data.currencies).filter(f=>`${f.code}${f.name}`.toLowerCase().includes(query));
    $('#fx-table-body').innerHTML=funds.map(f=>{
      const c=comparison(f.code),rows=f.history.slice(-60).map(p=>({date:p.date,power:1/p.cnyPerUnit}));
      return `<tr><td><button class="fund-name-button" data-fx="${f.code}">${esc(f.name)}</button><span class="metric-sub mono">${f.code}</span></td><td class="num" data-label="1人民币可换"><strong class="mono">${price(1/c.current.cnyPerUnit,6)}</strong><span class="metric-sub">${f.code}</span></td><td class="num" data-label="1外币折人民币"><strong class="mono">${price(c.current.cnyPerUnit,6)}</strong><span class="metric-sub">CNY</span></td><td data-label="人民币升贬值"><strong class="${powerClass(c.rmbChangePct)}">${signed(c.rmbChangePct)}</strong><span class="metric-sub">${directionText(c.rmbChangePct)}</span></td><td data-label="外币持仓折算影响"><strong class="${tone(c.assetFXPct)}">${signed(c.assetFXPct)}</strong><span class="metric-sub">外币资产不涨不跌时</span></td><td class="fx-table-trend" data-label="人民币购买力走势">${sparkline(rows,'power','1人民币兑换'+f.name,60)}</td><td class="fx-table-dates" data-label="参考日期"><span>${esc(c.current.date)}</span><span class="metric-sub">比较 ${esc(c.previous?.date||'暂缺')}</span></td></tr>`;
    }).join('')||'<tr><td colspan="7" class="empty">没有匹配的货币。</td></tr>';
    $('#fx-count').textContent=`${funds.length}种货币 · 点击货币名称切换换算与影响分析`;
  }
  function render(){
    if(!state.data)return;
    $('#fx-stamp').textContent=`日参考价 ${state.data.asOf} · 来源查询 ${chnDate(state.data.checkedAt)} ${cnTime(state.data.checkedAt)} 北京时间`;
    const age=(Date.now()-Date.parse(state.data.asOf+'T00:00:00+08:00'))/86400000;
    $('#fx-warning').hidden=age<=7&&!state.data.issues?.length;
    $('#fx-warning').textContent=age>7?'参考数据已超过7天，以下按历史数据展示，请勿当作当前成交价。':(state.data.issues||[]).join('；');
    renderOverview();renderConverter();renderChart();renderGold();renderTable();
  }
  async function refresh(force=false){
    if(state.busy||!force&&state.data&&Date.now()-state.lastFetch<300000)return;
    state.busy=true;$('#fx-reload').disabled=true;
    try{
      const data=await get(`./data/fx.json?t=${Date.now()}`);
      if(data.schemaVersion!==1||data.base!=='CNY'||!data.currencies?.USD||!data.asOf)throw new Error('Invalid FX data');
      if(!state.data||data.asOf>=state.data.asOf){state.data=data;$('#fx-currency').innerHTML=Object.values(data.currencies).map(f=>`<option value="${f.code}">${esc(f.name)} ${f.code}</option>`).join('');$('#fx-currency').value=state.currency;}
      state.lastFetch=Date.now();render();
    }catch{ $('#fx-warning').hidden=false;$('#fx-warning').textContent='汇率快照读取失败；保留已加载的参考价，请稍后重试。'; }
    finally{state.busy=false;$('#fx-reload').disabled=false;}
  }
  $('#fx-period').addEventListener('change',e=>{state.period=Number(e.target.value);render();});
  $('#fx-currency').addEventListener('change',e=>{state.currency=e.target.value;renderConverter();renderChart();});
  $('#fx-direction').addEventListener('change',renderConverter);
  for(const id of ['fx-amount','fx-asset-return'])$('#'+id).addEventListener('input',renderConverter);
  for(const id of ['fx-gold-usd','fx-gold-budget'])$('#'+id).addEventListener('input',renderGold);
  $('#fx-gold-live').addEventListener('change',()=>setMarkets(state.quotes));
  $('#fx-search').addEventListener('input',e=>{state.search=e.target.value.trim();renderTable();});
  $('#fx-table-body').addEventListener('click',e=>{const b=e.target.closest('[data-fx]');if(!b)return;state.currency=b.dataset.fx;$('#fx-currency').value=state.currency;renderConverter();renderChart();$('#fx-converter').scrollIntoView({behavior:'auto',block:'start'});$('#fx-currency').focus({preventScroll:true});});
  $('#fx-reload').addEventListener('click',()=>refresh(true));
  return {refresh,setMarkets};
}
