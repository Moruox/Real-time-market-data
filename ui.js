export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const price = (v, digits = 2) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
export const signed = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%` : '—';
export const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
export function sparkline(history, key='close', label='近期走势', length=60) {
  const rows=(history || []).filter(p=>Number.isFinite(p[key]) && p[key]>0).slice(-length);
  if(rows.length<2)return '<span class="muted spark-empty">暂无曲线</span>';
  const values=rows.map(p=>p[key]),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
  const points=values.map((v,i)=>`${(i/(values.length-1)*112).toFixed(1)},${(31-(v-lo)/span*28).toFixed(1)}`).join(' ');
  return `<svg class="spark spark-${tone(values.at(-1)-values[0])}" viewBox="0 0 112 35" role="img" aria-label="${esc(label)}，${esc(rows[0].date)}至${esc(rows.at(-1).date)}"><polyline points="${points}"/></svg>`;
}
export function historyPlot(rows, key, label, digits=4) {
  const values=rows.map(p=>p[key]),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
  if(rows.length<2 || !values.every(Number.isFinite))return '<p class="muted">暂无足够历史数据。</p>';
  const points=values.map((v,i)=>`${(i/(values.length-1)*640).toFixed(2)},${(150-(v-lo)/span*138).toFixed(2)}`).join(' ');
  return `<div class="interactive-chart" data-chart-key="${key}" data-chart-digits="${digits}"><div class="chart-reading"><span data-chart-date>${esc(rows.at(-1).date)}</span><strong data-chart-value>${price(values.at(-1),digits)}</strong></div><div class="plot-wrap"><div class="plot-scale"><span>${price(hi,digits)}</span><span>${price(lo,digits)}</span></div><svg viewBox="0 0 640 164" role="img" aria-label="${esc(label)}"><path class="plot-grid" d="M0 12H640M0 81H640M0 150H640"/><polyline class="plot-line" points="${points}"/><line class="plot-cursor" data-chart-cursor x1="640" x2="640" y1="0" y2="164"/></svg></div><div class="chart-dates"><span>${esc(rows[0].date)}</span><span>${esc(rows.at(-1).date)}</span></div><label class="chart-slider"><span>浏览历史数据</span><input type="range" min="0" max="${rows.length-1}" value="${rows.length-1}" aria-label="浏览${esc(label)}历史日期"></label></div>`;
}
export function bindHistoryPlot(root, rows) {
  const chart=root.querySelector('.interactive-chart');if(!chart)return;
  const input=chart.querySelector('input'),key=chart.dataset.chartKey,digits=Number(chart.dataset.chartDigits);
  const update=()=>{const i=Number(input.value),p=rows[i];chart.querySelector('[data-chart-date]').textContent=p.date;chart.querySelector('[data-chart-value]').textContent=price(p[key],digits);const x=i/(rows.length-1)*640;for(const k of ['x1','x2'])chart.querySelector('[data-chart-cursor]').setAttribute(k,x);};
  input.addEventListener('input',update);
  chart.querySelector('svg').addEventListener('pointermove',e=>{if(e.buttons && e.pointerType==='touch')return;const r=e.currentTarget.getBoundingClientRect();input.value=Math.round(Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))*(rows.length-1));update();});
}
