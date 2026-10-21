// Descriptive price conditions for long-term staged buying; no fitted return forecasts.
export function assess(technical, now = Date.now()) {
  const t = technical;
  if (!t || t.sampleSize < 252 || ![t.close, t.ma200, t.rsi14, t.drawdownPct, t.distance200Pct].every(Number.isFinite) || t.ma200 <= 0 || t.close <= 0 || t.rsi14 < 0 || t.rsi14 > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(t.asOf || '')) {
    return { key: 'missing', label: '资料不足', description: '需要252个已收盘交易日和有效的200日均线，暂不判断。' };
  }
  const age = (now - Date.parse(`${t.asOf}T23:59:59Z`)) / 86400000;
  if (!Number.isFinite(age) || age > 14 || age < -2) return { key: 'stale', label: '等待更新', description: '收盘日线距今超过14天或日期异常，暂停判断。' };
  if (t.drawdownPct <= -20) return { key: 'deep', label: '深度回撤', description: '较近252日收盘高点回撤至少20%。可列入分批研究清单，弱势可能延续，不代表见底。' };
  if (t.drawdownPct <= -10 && t.rsi14 <= 45) return { key: 'pullback', label: '回撤观察', description: '较近252日收盘高点回撤至少10%，且RSI不高于45。可评估小额分批，仍需结合估值和仓位。' };
  if (t.rsi14 >= 70 || t.distance200Pct >= 20) return { key: 'hot', label: '偏热观察', description: 'RSI至少70，或高于200日均线至少20%。谨慎追涨；这不是卖出信号。' };
  if (t.distance200Pct < 0) return { key: 'weak', label: '弱势观察', description: '收盘价低于200日均线，暂未触发回撤观察条件。下跌趋势尚可能持续。' };
  return { key: 'regular', label: '常规定投', description: '未触发深度回撤、回撤观察、偏热或弱势条件。可沿用原定计划，不表示低估或保证盈利。' };
}
export function validValuation(v, now = Date.now()) {
  return !!v && Number.isFinite(v.pe) && v.pe > 0 && /^\d{4}-\d{2}-\d{2}$/.test(v.date || '') && Date.parse(v.date) <= now + 86400000;
}
export const RULES = [
  ['深度回撤', '较近252日收盘高点回撤 ≥20%，提示研究分批机会及持续下跌风险。'],
  ['回撤观察', '回撤 ≥10%，且RSI14 ≤45。'],
  ['偏热观察', 'RSI14 ≥70，或收盘价高于200日均线 ≥20%。'],
  ['弱势观察', '收盘价低于200日均线，且不满足前面条件。'],
  ['常规定投', '以上条件均未触发。']
];
