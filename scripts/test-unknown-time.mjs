import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const entry=`
import {mountCouponCalendar} from '${root}/src/planner.js';
import {createAppTemplate} from '${root}/src/template.ts';
const card=(id)=>({id,type:'voucher',title:id,status:'used',validFrom:'2026-09-01',validTo:'2026-09-30',usableStart:'09:00',usableEnd:'21:00',tags:[]});
const seed={cards:[card('unknown'),card('invalid'),card('outside')],events:[
{id:'sch_unknown',cardId:'unknown',date:'2026-09-25',start:'',end:'',timeUnknown:true,status:'used'},
{id:'sch_invalid',cardId:'invalid',date:'2026-09-25',start:'10:00',end:'09:00',timeUnknown:false,status:'used'},
{id:'sch_outside',cardId:'outside',date:'2026-10-06',start:'',end:'',timeUnknown:true,status:'used'}
],view:'month',cursorDate:'2026-09-21',selectedCardId:'unknown',selectedEventId:'sch_unknown'};
window.lastSave=null;
document.getElementById('host').innerHTML=createAppTemplate('');
window.cleanup=await mountCouponCalendar(document.getElementById('host'),{
loadState:async()=>structuredClone(seed),saveState:s=>window.lastSave=structuredClone(s),layoutElement:document.getElementById('host')});
window.ready=true;
`;
const bundle=await build({stdin:{contents:entry,resolveDir:root},bundle:true,write:false,platform:'browser',format:'esm'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="host" style="width:1000px"></div>');await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>window.ready);
 assert.equal(await page.locator('[data-event-id="sch_unknown"]').evaluate(e=>e.classList.contains('is-error')),false);
 assert.match(await page.locator('#detailBody').innerText(),/时间未记录/);
 assert.doesNotMatch(await page.locator('#detailBody').innerText(),/结束时间异常|不在可用时段/);
 assert.equal(await page.locator('[data-event-id="sch_invalid"]').evaluate(e=>e.classList.contains('is-error')),true);
 assert.equal(await page.locator('[data-event-id="sch_outside"]').evaluate(e=>e.classList.contains('is-error')),true);
 await page.click('#weekViewButton');
 assert.equal(await page.locator('.date-only-events [data-event-id="sch_unknown"]').count(),1);
 assert.equal(await page.locator('.calendar-cell [data-event-id="sch_unknown"]').count(),0);
 await page.click('.date-only-events [data-event-id="sch_unknown"]');
 await page.locator('#fieldEventStart').fill('09:00');
 assert.equal(await page.evaluate(()=>window.lastSave.events.find(e=>e.id==='sch_unknown').timeUnknown),true);
 assert.equal(await page.evaluate(()=>window.lastSave.events.find(e=>e.id==='sch_unknown').end),'');
 await page.locator('#fieldEventEnd').fill('10:00');
 assert.equal(await page.evaluate(()=>window.lastSave.events.find(e=>e.id==='sch_unknown').timeUnknown),false);
 assert.equal(await page.locator('.date-only-events [data-event-id="sch_unknown"]').count(),0);
 assert.equal(await page.locator('.calendar-cell [data-event-id="sch_unknown"]').count(),1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({unknownNotRed:true,invalidTimeStillRed:true,invalidDateStillRed:true,noInventedMidnight:true,noInventedEnd:true,explicitTimesClearFlag:true,realVaultWritten:false}));
 await page.evaluate(()=>window.cleanup());
}finally{await browser.close();}
