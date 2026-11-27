// [내 기록은 어디에?] 개인정보 안내 · 백업 · 이 기기 기록 모두 지우기 테스트 (center-cloud v1.1): node localtest.js
const {chromium}=require('playwright');const assert=require('assert');
const FILE='file://'+__dirname+'/build/index.html';
(async()=>{
  const b=await chromium.launch();const errs=[];let n=0;const ok=m=>{n++;console.log('  통과: '+m);};
  const c=await b.newContext({viewport:{width:1180,height:900},acceptDownloads:true});await c.addInitScript(()=>{Object.defineProperty(window, 'CENTER_CLOUD_CONFIG', { configurable: true, get() { return { url: '', anonKey: '' }; }, set() {} });});const p=await c.newPage();
  p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>{errs.push('브라우저 기본 창: '+d.message());d.dismiss();});
  await p.goto(FILE);await p.waitForTimeout(400);await p.click('[data-act=ex-add]');await p.waitForTimeout(300);await p.click('#zoomBtn');
  assert.ok(await p.evaluate(()=>!!localStorage.getItem('cj.data')));
  await p.click('#ccChip');await p.waitForSelector('.cc-dlg[open]');
  const t=await p.textContent('.cc-dlg');
  assert.match(t,/개인정보 안내/);assert.match(t,/운전자·동승자 이름/);assert.match(t,/차량 1대 · 운행 기록 \d+건/);ok('개인정보 안내와 이 기기 기록 수');
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('.cc-dlg [data-a="backup"]')]);assert.match(dl.suggestedFilename(),/백업.*\.json$/);ok('백업 파일 받기: '+dl.suggestedFilename());
  assert.ok(await p.isVisible('.cc-dlg[open] [data-a="wipe"]'));ok('백업을 받아도 안내 창은 그대로');
  await p.click('.cc-dlg [data-a="wipe"]');assert.match(await p.textContent('.cc-dlg'),/되살릴 수 없어요/);await p.click('.cc-dlg [data-v=""]');
  assert.ok(await p.evaluate(()=>!!localStorage.getItem('cj.data')));ok('취소하면 그대로');
  await p.click('.cc-dlg [data-a="wipe"]');await Promise.all([p.waitForNavigation(),p.click('.cc-dlg [data-v="wipe"]')]);await p.waitForTimeout(600);
  const left=await p.evaluate(()=>Object.keys(localStorage));
  assert.ok(!left.some(k=>k.startsWith('cj.')),'남은 칸: '+left);assert.ok(left.includes('cc.zoom'));ok('모두 지우기: cj.* 지우고 글자 크기는 남김');
  assert.match(await p.textContent('#view'),/차량부터 등록/);assert.match(await p.textContent('#ccToast'),/모두 지웠어요/);ok('처음 화면으로 돌아가고 알림');
  await b.close();if(errs.length){console.log('오류:',errs);process.exit(1);}console.log('이 기기 기록 테스트 '+n+'개 통과');
})().catch(e=>{console.error(e);process.exit(1);});
