import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, validValuation } from '../analysis.js';
const now = Date.parse('2026-10-21T04:00:00Z');
const base = { asOf:'2026-10-20', sampleSize:252, close:100, ma200:95, rsi14:50, drawdownPct:-5, distance200Pct:5 };
test('Price conditions use explicit boundaries and precedence, not assumed PE', () => {
  assert.equal(assess(base, now).key, 'regular');
  assert.equal(assess({...base,drawdownPct:-20,rsi14:75},now).key,'deep');
  assert.equal(assess({...base,drawdownPct:-10,rsi14:45},now).key,'pullback');
  assert.equal(assess({...base,rsi14:70},now).key,'hot');
  assert.equal(assess({...base,distance200Pct:20},now).key,'hot');
  assert.equal(assess({...base,distance200Pct:-1},now).key,'weak');
});
test('Missing, short and stale history cannot issue a buying reference', () => {
  assert.equal(assess(null,now).key,'missing');
  assert.equal(assess({...base,sampleSize:251},now).key,'missing');
  assert.equal(assess({...base,asOf:'2026-09-01'},now).key,'stale');
  assert.equal(assess({...base,ma200:null},now).key,'missing');
});
test('Absent PE, a zero placeholder or a future date is not a valid valuation', () => {
  assert.equal(validValuation({pe:14.08,date:'2026-10-20'},now),true);
  for (const v of [null,{pe:0,date:'2026-10-20'},{pe:null,date:'2026-10-20'},{pe:14,date:'2026-12-01'}]) assert.equal(validValuation(v,now),false);
});
