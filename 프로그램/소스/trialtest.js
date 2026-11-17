// 체험판 테스트: node trialtest.js  (기한 안 / 기한 지난 뒤 / 인쇄·CSV·한글 파일 표시)
const {chromium}=require('playwright'),fs=require('fs');
const html=fs.readFileSync(__dirname+'/build/trial/index.html','utf8').replace(/<link[^>]*fonts\.googleapis[^>]*>/g,'');
fs.writeFileSync(__dirname+'/build/trial/_t.html',html);
const url='file://'+__dirname+'/build/trial/_t.html';let fail=0;const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)fail++;};
(async()=>{const b=await chromium.launch();
 async function open(when){const c=await b.newContext({acceptDownloads:true});await c.clock.setFixedTime(new Date(when));const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(url);await p.waitForTimeout(400);return {p,errs,c};}
 // 기한 안
 let {p,errs,c}=await open('2026-11-17T10:00:00');
 ok(await p.isVisible('#trialBar'),'체험판 띠 보임');
 ok((await p.textContent('#trialBar')).includes('박정환'),'만든 사람 표시');
 ok(!(await p.$('#trialEnd')),'기한 안에는 끝 안내 없음');
 await p.click('[data-act=ex-add]');await p.waitForTimeout(200);await p.click('#tab-log');
 await p.click('#fileMenu summary');
 let [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-act=csv]')]);
 const csv=fs.readFileSync(await dl.path(),'utf8');ok(csv.split('\r\n')[0].includes('체험판'),'CSV 첫 줄 체험판');ok(csv.charCodeAt(0)===0xfeff,'CSV BOM 유지');
 await p.click('#fileMenu summary').catch(()=>{});
 if(!(await p.isVisible('[data-act=hwpx]'))) await p.click('#fileMenu summary');
 [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-act=hwpx]')]);
 const zip=fs.readFileSync(await dl.path()).toString('utf8');ok(zip.includes('체험판 · 만든 사람'),'한글 파일 안 체험판 줄');
 await p.evaluate(()=>{window.print=()=>{};});await p.click('[data-act=print]');await p.waitForTimeout(200);
 ok((await p.innerHTML('#printArea')).includes('trialft'),'인쇄물 체험판 표시');
 ok(errs.length===0,'오류 없음 '+errs.join('|'));await c.close();
 // 기한 마지막 날 / 지난 뒤
 ({p,errs,c}=await open('2026-12-31T23:30:00'));ok(!(await p.$('#trialEnd')),'12/31 밤까지 사용 가능');await c.close();
 ({p,errs,c}=await open('2027-01-01T00:10:00'));
 ok(await p.isVisible('#trialEnd'),'1/1 끝 안내 보임');ok(!(await p.isVisible('[data-act=ex-add]')),'프로그램 화면 숨김');
 ok(errs.length===0,'오류 없음 '+errs.join('|'));await p.screenshot({path:__dirname+'/shots/trial_end.png'});await c.close();
 ({p,c}=await open('2026-11-17T10:00:00'));await p.setViewportSize({width:1280,height:800});await p.screenshot({path:__dirname+'/shots/trial_home.png'});
 await b.close();fs.unlinkSync(__dirname+'/build/trial/_t.html');console.log(fail?fail+' FAIL':'all pass');process.exit(fail?1:0);})();
