import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shim = `
export class TFile { constructor(path) { this.path=path; this.basename=path.split('/').pop().replace(/\\.md$/, ''); this.stat={mtime:1}; } }
export class TFolder { constructor(path) {this.path=path;} }
export class Plugin { constructor(app) {this.app=app;} registerView(){} addRibbonIcon(){} addCommand(){} registerEvent(){} async loadData(){return null;} async saveData(){} }
export class ItemView {}
export class Notice {constructor(message){ window.harnessNotices.push(message); }}
export const normalizePath=s=>s;
export const parseYaml=JSON.parse;
export const stringifyYaml=JSON.stringify;
export const requestUrl=()=>{throw new Error('No network in fixture');};
`;
const entry = `
import Plugin from '${root}/src/main.ts';
import { TFile, TFolder } from 'obsidian';
import { mountCouponCalendar } from '${root}/src/planner.js';
import { createAppTemplate } from '${root}/src/template.ts';
window.harnessNotices=[];
const files=new Map(), contents=new Map(), events=new Map();
let refreshes=0;
const emit=(name,file)=>{ for(const cb of events.get(name)||[]) cb(file); };
const vault={
 on:(name,cb)=>{events.set(name,[...(events.get(name)||[]),cb]);return ()=>{};},
 getAbstractFileByPath:path=>files.get(path)||null,
 getMarkdownFiles:()=>[...files.values()].filter(f=>f instanceof TFile),
 cachedRead:async file=>contents.get(file.path),
 createFolder:async path=>{const f=new TFolder(path);files.set(path,f);emit('create',f);},
 create:async(path,text)=>{const f=new TFile(path);files.set(path,f);contents.set(path,text);emit('create',f);return f;},
 modify:async(file,text)=>{contents.set(file.path,text);file.stat.mtime++;emit('modify',file);},
 trash:async()=>{throw new Error('Fixture never deletes cards');}
};
const app={vault,metadataCache:{getFileCache:()=>null}};
const plugin=new Plugin(app); await plugin.onload();
plugin.subscribePlannerChanges(()=>refreshes++);
const host=document.getElementById('host');host.innerHTML=createAppTemplate('');
const cleanup=await mountCouponCalendar(host,{
 loadState:()=>plugin.loadPlannerState(), saveState:s=>plugin.savePlannerState(s),
 reloadState:s=>plugin.reloadPlannerState(s),subscribeToChanges:l=>plugin.subscribePlannerChanges(l),layoutElement:host
});
window.harness={plugin,files,contents,get refreshes(){return refreshes;},cleanup,
 async flush(){await plugin.flushPlannerState();},
 async externalTitle(title){const file=vault.getMarkdownFiles()[0];const old=contents.get(file.path);const parts=old.split('---\\n');const fm=JSON.parse(parts[1]);fm.title=title;await vault.modify(file,'---\\n'+JSON.stringify(fm)+'\\n---\\n# '+title+'\\n');},
 titles(){return vault.getMarkdownFiles().map(f=>JSON.parse(contents.get(f.path).split('---\\n')[1]).title);}
};
`;
const result = await build({ stdin: { contents: entry, resolveDir: root, sourcefile:'focus-fixture.js' },
  bundle:true, write:false, format:'esm', platform:'browser', loader:{'.png':'dataurl'},
  plugins:[{name:'memory-vault',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:shim,loader:'js'}));}}] });
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="host" style="width:1000px"></div>');
 await page.addScriptTag({type:'module',content:result.outputFiles[0].text});
 await page.waitForFunction(()=>!!window.harness);
 await page.click('#addCardButton');
 const title=page.locator('#fieldTitle');await title.fill('');
 await title.pressSequentially('abc', {delay:80});
 await page.waitForTimeout(1000); // first debounced create plus external-refresh window
 await title.pressSequentially('DEFG', {delay:450});
 assert.equal(await title.inputValue(),'abcDEFG');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'fieldTitle');
 await page.evaluate(()=>window.originalInput=document.querySelector('#fieldTitle'));
 await page.evaluate(()=>{const e=document.querySelector('#fieldTitle');e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.value+='zhong';e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'zhong',isComposing:true}));});
 await page.waitForTimeout(1100);
 assert.equal(await page.evaluate(()=>window.originalInput===document.querySelector('#fieldTitle')),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'fieldTitle');
 await page.evaluate(()=>{const e=document.querySelector('#fieldTitle');e.value=e.value.replace(/zhong$/,'中文');e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'中文'}));});
 await page.waitForTimeout(1100);
 assert.equal(await title.inputValue(),'abcDEFG中文');
 await page.evaluate(()=>window.harness.flush());
 assert.deepEqual(await page.evaluate(()=>window.harness.titles()),['abcDEFG中文']);
 assert.equal(await page.evaluate(()=>window.harness.refreshes),0);
 await page.evaluate(()=>window.harness.externalTitle('外部修改验证'));
 await page.waitForFunction(()=>document.querySelector('#fieldTitle')?.value==='外部修改验证');
 assert.equal(await page.evaluate(()=>window.harness.refreshes),1);
 assert.deepEqual(await page.evaluate(()=>window.harnessNotices),[]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({continuousTyping:true,pausedSave:true,compositionNodePreserved:true,persistedTitle:true,selfWriteRefreshes:0,externalRefreshes:1,realVaultWritten:false}));
 await page.evaluate(()=>{window.harness.cleanup();window.harness.plugin.onunload();});
} finally {await browser.close();}
