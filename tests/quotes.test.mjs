import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTencent, parseEastmoney, mergeQuotes, zonedISO } from '../quotes.js';

test('US source time uses DST-aware Eastern time, not Beijing', () => {
  assert.equal(zonedISO('2026-10-20 16:00:00', 'America/New_York'), '2026-10-20T20:00:00.000Z');
  assert.equal(zonedISO('2026-12-01 16:00:00', 'America/New_York'), '2026-12-01T21:00:00.000Z');
});
test('Tencent regular-session price is separate from bid/ask values', () => {
  const a = Array(33).fill('0'); a[3] = '100'; a[9] = '110'; a[30] = '2026-10-20 16:00:00'; a[32] = '-1.25';
  const q = parseTencent(`v_usQQQ="${a.join('~')}";`, [{ id:'qqq', tencent:'usQQQ' }]);
  assert.equal(q.qqq.price, 100); assert.equal(q.qqq.changePct, -1.25);
  assert.equal(q.qqq.quoteAt, '2026-10-20T20:00:00.000Z');
});
test('Missing data is not converted to zero and symbol matching ignores case', () => {
  const items = [{ id:'au', eastmoney:'113.aum', group:'gold' }];
  assert.deepEqual(parseEastmoney({data:{diff:[{f13:113,f12:'AUM',f2:'-',f3:'-',f124:1700000000}]}}, items), {});
  assert.equal(parseEastmoney({data:{diff:[{f13:113,f12:'AUM',f2:800,f3:-1,f124:1700000000}]}}, items).au.price,800);
});
test('An older snapshot cannot overwrite a newer browser quote', () => {
  const old = {price:100,changePct:1,quoteAt:'2026-10-20T01:00:00Z'};
  const fresh = {price:110,changePct:2,quoteAt:'2026-10-20T02:00:00Z'};
  const state = {x:fresh}; assert.equal(mergeQuotes(state,{x:old}),0); assert.equal(state.x.price,110);
});
