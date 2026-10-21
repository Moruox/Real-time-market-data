import test from 'node:test';
import assert from 'node:assert/strict';
import {compareFX,convertAmount,goldFX,translatedReturn,TROY_OUNCE_GRAMS} from '../fx.js';
const history=[{date:'2026-09-18',cnyPerUnit:7.2},{date:'2026-10-19',cnyPerUnit:6.9},{date:'2026-10-20',cnyPerUnit:6.8}];
test('CNY purchasing power and foreign asset translation have distinct denominators',()=>{const c=compareFX(history,30);assert.equal(c.previous.date,'2026-09-18');assert.ok(Math.abs(c.rmbChangePct-5.882352941)<1e-8);assert.ok(Math.abs(c.assetFXPct+5.555555556)<1e-8);assert.equal(compareFX(history,1).previous.date,'2026-10-19');assert.equal(compareFX(history,365).previous,null);});
test('two-way conversion and invalid amounts',()=>{assert.equal(convertAmount(680,6.8),100);assert.equal(convertAmount(100,6.8,'in'),680);assert.equal(convertAmount(NaN,6.8),null);assert.equal(convertAmount(-1,6.8),null);assert.equal(convertAmount(1,0),null);assert.equal(convertAmount(0,6.8),0);});
test('gold holds USD price constant and uses troy ounces',()=>{const g=goldFX(3000,6.8,7.2);assert.equal(g.current,20400/TROY_OUNCE_GRAMS);assert.equal(g.previous,21600/TROY_OUNCE_GRAMS);assert.ok(g.saving>0);assert.equal(goldFX(0,6.8,7.2),null);});
test('foreign return compounds with FX, including total loss',()=>{assert.ok(Math.abs(translatedReturn(10,6.8,7.2)-3.888888889)<1e-8);assert.equal(translatedReturn(-100,6.8,7.2),-100);assert.equal(translatedReturn(-101,6.8,7.2),null);assert.equal(compareFX([]),null);});
