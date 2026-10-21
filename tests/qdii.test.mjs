import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quotaState,filterFunds,fundInsight,fundNavInsight} from '../qdii.js';
const now=Date.parse('2026-10-21T04:10:00Z');
const fund={code:'000001',name:'测试纳斯达克100ETF联接A',family:'测试',index:'ndx',currency:'CNY',shareClass:'A',quota:{verified:true,checkedAt:'2026-10-21T12:00:00+08:00',state:'limited',dailyLimit:10,limitText:'10.00元',limitUnit:'元',minimum:1}};
test('A retained numeric quota does not override a suspended purchase state',()=>{
 const v=quotaState({...fund,quota:{...fund.quota,state:'paused'}},now);
 assert.equal(v.available,false);assert.equal(v.limit,'暂停');assert.match(v.note,/10.00元/);
});
test('Missing units, zero caps, unverified channels and stale snapshots cannot claim availability',()=>{
 assert.equal(quotaState({...fund,quota:{...fund.quota,dailyLimit:0,limitText:null}},now).available,false);
 assert.equal(quotaState({...fund,quota:{...fund.quota,verified:false}},now).available,false);
 assert.equal(quotaState(fund,now+3*3600000).key,'stale');
 assert.equal(quotaState({...fund,quota:{...fund.quota,minimum:20}},now).available,false);
 assert.equal(quotaState(fund,now).available,true);
});
test('Currency, share class, benchmark variants and availability filters are independent',()=>{
 const usd={...fund,code:'000002',currency:'USD',shareClass:'C'};
 const equal={...fund,code:'000003',index:'sp500ew'};
 assert.equal(filterFunds([fund,usd,equal],{index:'sp500'},now).length,0);
 assert.deepEqual(filterFunds([fund,usd,equal],{currency:'USD',share:'C'},now).map(f=>f.code),['000002']);
 assert.equal(filterFunds([fund,usd,equal],{index:'ndx',onlyOpen:true},now).length,2);
});

test('Active, bond and strategy funds do not inherit broad-index valuations or signals',()=>{
 const a={ndx:{valuation:{pe:25,date:'2026-10-20'}}};
 assert.equal(fundInsight({category:'active'},a,now).signal.label,'暂不判断');
 assert.equal(fundInsight({category:'bond'},a,now).valuation,'PE / PB不适用');
 assert.equal(fundInsight({category:'index',index:'sp500ew'},a,now).valuation,'估值暂缺');
 assert.match(fundInsight({category:'index',benchmark:'ndx'},a,now).valuation,/25/);
 assert.equal(filterFunds([{...fund,category:'index'},{...fund,category:'active'}],{category:'index'},now).length,1);
});

test('Fund NAV signals require verified adjusted returns and matching dates, not raw NAV',()=>{
 const t={asOf:'2026-10-20',sampleSize:252,close:100,ma200:102,rsi14:40,drawdownPct:-15,distance200Pct:-2};
 const f={category:'active',navData:{navDate:'2026-10-20',nav:.8,adjusted:{version:1,method:'published-daily-return-chain-v1',status:'ready',sampleSize:252,asOf:t.asOf,technical:t}}};
 assert.equal(fundNavInsight(f,now).signal.key,'pullback');
 assert.equal(fundNavInsight({...f,navData:{navDate:'2026-10-20',nav:.2}},now).signal.key,'missing');
 assert.equal(fundNavInsight({...f,navData:{...f.navData,navDate:'2026-10-21'}},now).signal.key,'missing');
 assert.equal(fundNavInsight({...f,category:'bond'},now).signal.label,'仅看走势');
 assert.equal(fundNavInsight({...f,category:'allocation'},now).signal.label,'仅看走势');
 assert.equal(fundNavInsight(f,now+30*86400000).signal.key,'stale');
 assert.equal(fundNavInsight({...f,navData:{...f.navData,adjusted:{...f.navData.adjusted,status:'insufficient'}}},now).signal.key,'missing');
});
