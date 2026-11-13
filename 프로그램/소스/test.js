// 브라우저 자동 테스트 (Playwright 필요): node test.js
const {chromium}=require('playwright');const assert=require('assert');
const FILE='file://'+__dirname+'/build/index.html';
require('fs').mkdirSync(__dirname+'/shots',{recursive:true});
(async()=>{
  const b=await chromium.launch();const errs=[];let n=0;const ok=(name)=>{n++;console.log('  통과: '+name)};
  const watch=p=>p.on('pageerror',e=>errs.push(e.message));
  /* ---------- 1. 파일판 흐름 ---------- */
  const ctx=await b.newContext({viewport:{width:1180,height:900}});const p=await ctx.newPage();watch(p);
  await p.goto(FILE);await p.waitForTimeout(500);
  assert.match(await p.locator('#view h2').first().innerText(),/차량부터 등록/);
  await p.click('[data-act=ex-add]');await p.waitForTimeout(200);
  // v4: 첫 화면에서 점검은 폴더 하나로 접혀 있고, 누르면 펼쳐진다
  assert.equal(await p.locator('#careFold').getAttribute('open'),null);assert.equal(await p.locator('.tile').first().isVisible(),false);
  assert.match(await p.locator('#careFold summary').innerText(),/차량 점검 · 정비 알림[\s\S]*지난 것 1개/);
  const vt=await p.locator('#view').innerText();assert.ok(vt.indexOf('최근 운행')<vt.indexOf('차량 점검 · 정비 알림'),'일지가 점검보다 위');
  await p.click('#careFold summary');assert.equal(await p.locator('.tile').first().isVisible(),true);ok('첫 화면: 점검은 폴더로 접혀 있고 누르면 펼쳐짐');
  assert.match(await p.locator('.board .bubble b').innerText(),/점검할 시기가 지났어요/);assert.match(await p.locator('.board .bubble').innerText(),/에어컨 필터/);ok('노랑이가 점검할 시기를 말해 줌');
  assert.match(await p.locator('.season').innerText(),/가을철|겨울철|봄철|장마철|한여름/);await p.click('[data-act=season]');assert.ok(await p.locator('.tips li').count()>=4);await p.click('#dlg footer [data-act=dlg-close]');ok('철 관리 도움말');
  assert.equal(await p.locator('.tile').count(),15);assert.equal(await p.locator('.tile.over').count(),1);assert.equal(await p.locator('.tile.unk').count(),3);ok('타일 15개, 지남 1, 기록 필요 3');
  await p.click('.tile[data-v=oil]');assert.match(await p.locator('#dlg').innerText(),/계산 근거/);assert.match(await p.locator('#dlg').innerText(),/62,000km/);await p.click('#dlg footer [data-act=dlg-close]');ok('타일을 누르면 근거');
  await p.click('[data-act=bulk]');const today=await p.evaluate(()=>today());await p.fill('#bd_tire','2025-05-01');await p.fill('#bk_tire','40000');await p.click('[data-act=bulk-save]');await p.waitForTimeout(200);
  assert.equal(await p.locator('.tile.unk').count(),2);ok('한 번에 적기');
  await p.click('[data-act=trip-new]');await p.fill('#tEnd','61446');await p.click('[data-act=trip-save]');assert.match(await p.locator('#tErr').innerText(),/출발 시간/);
  await p.selectOption('#tST_h','13');await p.selectOption('#tST_m','30');await p.selectOption('#tET_h','13');await p.selectOption('#tET_m','00');await p.click('[data-act=trip-save]');assert.match(await p.locator('#tErr').innerText(),/도착 시간이 출발 시간보다/);await p.selectOption('#tET_h','14');await p.selectOption('#tET_m','05');
  await p.fill('#tEnd','61400');await p.click('[data-act=trip-save]');assert.match(await p.locator('#tErr').innerText(),/작아요/);await p.fill('#tEnd','61446');assert.match(await p.locator('#tDist').innerText(),/= 15km/);
  // 저장하지 않고 닫으면 보관하고 알려 준다
  await p.click('#dlg header [data-act=trip-close]');await p.waitForTimeout(200);assert.match(await p.locator('#view').innerText(),/저장하지 않은 운행 기록이 있어요/);
  await p.reload();await p.waitForTimeout(300);await p.click('[data-act=trip-new] >> nth=0');assert.equal(await p.inputValue('#tEnd'),'61446');assert.equal(await p.inputValue('#tST'),'13:30');ok('저장하지 않고 닫아도 쓰던 내용 보관·알림');
  await p.click('[data-act=chk-all]');await p.check('#tDrvOk');await p.fill('#tGuard','이선생');await p.click('[data-act=trip-save]');await p.waitForTimeout(200);
  assert.equal(await p.locator('[data-act=draft-drop]').count(),0);assert.match(await p.locator('.toast').last().innerText(),/동승자 확인/);
  assert.equal(await p.evaluate(()=>CJ.odoOf(CJ.state(),'ex-v1')),61446);assert.equal(await p.evaluate(()=>CJ.state().vehicles['ex-v1'].odo),61446);ok('운행 기록과 주행거리');
  // km가 안 이어지는 기록
  await p.click('[data-act=trip-new]');await p.selectOption('#tST_h','15');await p.selectOption('#tST_m','00');await p.selectOption('#tET_h','15');await p.selectOption('#tET_m','20');await p.fill('#tStart','61500');await p.fill('#tEnd','61510');await p.click('[data-act=trip-save]');await p.waitForTimeout(200);
  await p.click('#tab-log');assert.match(await p.locator('.warn').innerText(),/54km 비어요/);ok('km가 안 이어지면 표시');
  assert.match(await p.locator('thead').innerText(),/일자\s+출발 시간\s+도착 시간\s+운행 목적\s+운행 거리\s+운전자 확인\s+동승자 확인\s+차량 점검 내용/);assert.match(await p.locator('tbody').innerText(),/이상 없음 \(6항목 점검\)/);ok('운행일지 칸: 일자·출발·도착·목적·거리·운전자 확인·동승자 확인·점검 내용');
  assert.match(await p.locator('tfoot').innerText(),/16회 운행/);
  // 마감
  await p.click('[data-act=lock]');await p.click('[data-act=lock2]');await p.waitForTimeout(200);
  assert.equal(await p.locator('[data-act=trip-edit]').count(),0);assert.equal(await p.locator('[data-act=trip-new]').count(),0);
  await p.click('#tab-home');await p.click('[data-act=trip-new]');await p.selectOption('#tST_h','16');await p.selectOption('#tST_m','00');await p.selectOption('#tET_h','16');await p.selectOption('#tET_m','10');await p.fill('#tEnd','61520');await p.click('[data-act=trip-save]');assert.match(await p.locator('#tErr').innerText(),/마감한 달/);await p.click('#dlg footer [data-act=trip-close]');await p.click('[data-act=draft-drop]');ok('마감한 달은 고칠 수 없음');
  await p.click('#tab-log');await p.click('[data-act=unlock]');await p.click('[data-act=unlock2]');await p.waitForTimeout(200);assert.ok(await p.locator('[data-act=trip-edit]').count()>0);
  // 교환 기록 → 다시 계산
  await p.click('#tab-care');await p.click('[data-act=svc-new][data-v=oil]');await p.click('[data-act=svc-save]');await p.waitForTimeout(200);
  assert.equal(await p.evaluate(()=>CJ.itemStatus(CJ.state(),'ex-v1',CJ.ITEMS[0],today()).st),'ok');ok('교환 기록 뒤 다시 계산');
  // 전기차
  await p.click('#tab-set');await p.click('[data-act=veh-edit]');await p.click('[data-f=vFuel][data-v="전기"]');await p.click('[data-act=veh-save]');await p.waitForTimeout(200);await p.click('#tab-home');
  assert.equal(await p.locator('.tile').count(),12);ok('전기차는 엔진 항목 숨김');
  // 백업 → 새 브라우저에서 복원
  const [dl]=await Promise.all([p.waitForEvent('download'),(async()=>{await p.click('#tab-set');await p.click('[data-act=backup]');})()]);const bk=__dirname+'/build/backup.json';await dl.saveAs(bk);
  const ctx2=await b.newContext();const p2=await ctx2.newPage();watch(p2);await p2.goto(FILE);await p2.waitForTimeout(300);await p2.setInputFiles('#restoreFile',bk);await p2.waitForTimeout(300);
  assert.equal(await p2.evaluate(()=>Object.keys(CJ.state().trips).length),16);assert.equal(await p2.evaluate(()=>Object.keys(CJ.state().drivers).length),2);ok('백업과 복원');
  await p.reload();await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>Object.keys(CJ.state().trips).length),16);ok('새로 고침 뒤에도 유지');
  // 예전 형식(설정 안의 운전자) 옮기기
  const ctx3=await b.newContext();const p3=await ctx3.newPage();watch(p3);await p3.goto(FILE);
  await p3.evaluate(()=>localStorage.setItem('cj.data',JSON.stringify({vehicles:{v:{name:'옛차',baseOdo:100,ts:1}},trips:{},services:{},settings:{center:'옛센터',drivers:[{name:'박선생',edu:'2025-01-01'}]}})));await p3.reload();await p3.waitForTimeout(300);
  assert.equal(await p3.evaluate(()=>Object.values(CJ.state().drivers)[0].name),'박선생');assert.equal(await p3.evaluate(()=>CJ.state().settings.drivers),undefined);ok('예전 자료 형식 옮기기');

  const ctx4=await b.newContext();const p4=await ctx4.newPage();watch(p4);await p4.goto(FILE);
  await p4.evaluate(()=>{const tr={};for(let i=0;i<10;i++)tr['t'+i]={vid:'v',date:'2026-11-0'+(i%9+1),startKm:100+i,endKm:101+i,driver:'김',purpose:'등원'};localStorage.setItem('cj.data',JSON.stringify({vehicles:{v:{name:'차',baseOdo:100,ts:1}},trips:tr,services:{},drivers:{},settings:{}}));});await p4.reload();await p4.waitForTimeout(300);
  assert.match(await p4.locator('#view').innerText(),/기록이 날아가지 않게 백업해 두세요/);ok('이 기기에만 저장할 때 백업 알림');

  /* ---------- 1-2. v4: 바로 적기, 표에 바로 적기, 영수증 양식, 사용 방법 ---------- */
  const c5=await b.newContext({viewport:{width:1180,height:900}});const q=await c5.newPage();watch(q);await q.goto(FILE);await q.waitForTimeout(300);
  await q.click('[data-act=ex-add]');await q.waitForTimeout(200);
  assert.equal(await q.locator('#careFold').getAttribute('open'),null);
  assert.ok(await q.locator('[data-act=trip-like]').count()>=2);await q.click('[data-act=trip-like] >> nth=0');
  assert.match(await q.locator('#dlg').innerText(),/채워 두었어요/);assert.ok(['등원','하원'].includes(await q.inputValue('#tPurpose')));assert.notEqual(await q.inputValue('#tST'),'');assert.equal(await q.inputValue('#tEnd'),'');
  const mins=await q.locator('#tST_m option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean));assert.deepEqual(mins,['00','05','10','15','20','25','30','35','40','45','50','55']);
  assert.equal(+(await q.inputValue('#tET')).slice(3)%5,0);ok('시간은 5분 단위로 고름');
  const st=+(await q.inputValue('#tStart'));await q.fill('#tEnd',String(st+14));await q.click('[data-act=chk-all]');await q.check('#tDrvOk');await q.check('#tGuardOk');await q.click('[data-act=trip-save]');await q.waitForTimeout(200);
  assert.equal(await q.evaluate(()=>Object.keys(CJ.state().trips).length),15);ok('자주 하는 운행 바로 적기: 도착 km만 적고 저장');
  await q.click('#tab-log');assert.equal(await q.locator('#entryRow').count(),1);
  await q.selectOption('#rST_h','15');await q.selectOption('#rST_m','00');await q.selectOption('#rET_h','15');await q.selectOption('#rET_m','30');await q.fill('#rEnd','10');await q.press('#rEnd','Enter');assert.match(await q.locator('#rowErr').innerText(),/작아요/);
  const s2=+(await q.inputValue('#rStart'));await q.fill('#rEnd',String(s2+12));await q.fill('#rGuard','이선생');await q.check('#rChk');await q.check('#rDrvOk');await q.press('#rEnd','Enter');await q.waitForTimeout(200);
  assert.equal(await q.evaluate(()=>Object.keys(CJ.state().trips).length),16);assert.equal(await q.inputValue('#rGuard'),'이선생');assert.equal(await q.inputValue('#rStart'),String(s2+12));assert.equal(await q.inputValue('#rEnd'),'');
  assert.match(await q.locator('tbody').innerText(),/이상 없음 \(6항목 점검\)/);ok('표에 바로 적기: Enter로 저장, 다음 줄은 출발 km·동승자가 이어짐');
  await q.click('[data-act=row-mode]');assert.equal(await q.locator('#entryRow').count(),0);await q.click('[data-act=row-mode]');assert.equal(await q.locator('#entryRow').count(),1);ok('표에 바로 적기 끄고 켜기');
  await q.click('#tab-care');await q.click('[data-act=exp-new]');await q.fill('#eCost','');await q.click('#dlg [data-act=exp-save]:not([data-p])');assert.match(await q.locator('#eErr').innerText(),/금액/);
  await q.fill('#eCost','52000');await q.fill('#eShop','별빛주유소');await q.fill('#eMemo','경유');await q.click('#dlg [data-act=exp-save]:not([data-p])');assert.match(await q.locator('#eErr').innerText(),/주유량/);await q.fill('#eLit','35.2');
  await q.evaluate(()=>{window.print=()=>{window.__printed=document.getElementById('printArea').innerHTML;};});
  await q.click('[data-act=exp-save][data-p]');await q.waitForTimeout(200);
  let pr=await q.evaluate(()=>window.__printed);assert.match(pr,/지출 증빙서/);assert.match(pr,/영수증 원본/);assert.match(pr,/영수증 사본/);assert.match(pr,/52,000 원/);assert.match(pr,/별빛주유소/);assert.match(pr,/주유/);assert.match(pr,/주유량 35.2L/);
  assert.match(await q.locator('#view').innerText(),/주유\s+[\d,]+\s+52,000원/);
  assert.notEqual(await q.evaluate(()=>CJ.itemStatus(CJ.state(),'ex-v1',CJ.ITEMS[0],today()).st),'ok');ok('주유 기록 + 영수증 양식(원본·사본 칸) 인쇄, 점검 계산에는 영향 없음');
  await q.click('[data-act=svc-new][data-v=oil]');await q.fill('#sCost','85000');await q.fill('#sMemo','엔진오일 6L');await q.click('[data-act=svc-save][data-p]');await q.waitForTimeout(200);
  pr=await q.evaluate(()=>window.__printed);assert.match(pr,/엔진오일·오일필터/);assert.match(pr,/85,000 원/);assert.match(pr,/엔진오일 6L/);
  assert.equal(await q.evaluate(()=>CJ.itemStatus(CJ.state(),'ex-v1',CJ.ITEMS[0],today()).st),'ok');ok('엔진오일 교환 저장하고 영수증 양식 인쇄');
  await q.click('[data-act=rc-blank]');pr=await q.evaluate(()=>window.__printed);assert.match(pr,/지출 증빙서/);assert.doesNotMatch(pr,/52,000/);ok('빈 영수증 양식');
  // 유류수불대장: 지침 칸(연번·일자·주유량·금액·주행거리·비고·결재 담당/시설장)
  await q.click('#tab-log');await q.click('[data-act=fuel]');pr=await q.evaluate(()=>window.__printed);
  assert.match(pr,/유류수불대장/);for(const k of ['연번','일자','주유량','금액','주행거리','비고','결재','담당','시설장'])assert.ok(pr.includes('>'+k),k);
  assert.match(pr,/35.2 L/);assert.match(pr,/52,000원/);assert.match(pr,/합계 \(1회\)/);assert.equal((pr.match(/<tr>/g)||[]).length>=17,true);ok('유류수불대장: 지침 칸 그대로, 주유량·금액 합계');
  await q.click('[data-act=claim]');pr=await q.evaluate(()=>window.__printed);assert.match(pr,/유류수불대장/);

  assert.match(pr,/차량 운행일지/);assert.match(pr,/지출 내역/);assert.match(pr,/137,000원/);assert.equal((pr.match(/class="rc"/g)||[]).length,2);ok('청구용 인쇄: 운행일지 + 지출 내역(합계) + 영수증 양식 2장');
  await q.click('[data-act=help]');const ht=await q.locator('#dlg').innerText();assert.match(ht,/바탕화면/);assert.match(ht,/홈 화면에 추가/);assert.match(ht,/바로가기 만들기/);
  await q.click('[data-act=help-print]');pr=await q.evaluate(()=>window.__printed);assert.match(pr,/차량 지킴이 사용 방법/);await q.click('#dlg footer [data-act=dlg-close]');ok('사용 방법: 바탕화면·홈 화면에 두는 법, 인쇄');
  await q.click('#tab-home');await q.click('#careFold summary');await q.reload();await q.waitForTimeout(300);assert.notEqual(await q.locator('#careFold').getAttribute('open'),null);ok('점검 폴더를 펼친 상태를 기억');
  await q.screenshot({path:'shots/v4_home.png',fullPage:true});

  /* ---------- 2. 구글 시트판: 로그인 없이 휴대폰 → PC ---------- */
  const M=require('./gasmock')();let down=false;
  const mock=`window.google={script:{run:(function mk(s,f){return {withSuccessHandler:function(x){return mk(x,f)},withFailureHandler:function(x){return mk(s,x)},api:function(j){window.gasApi(j).then(function(r){r==null?f&&f(new Error('net')):s&&s(r)})}}})()}};`;
  async function device(vp){const c=await b.newContext({viewport:vp});const pg=await c.newPage();watch(pg);await pg.exposeFunction('gasApi',j=>down?null:M.api.api(j));await pg.addInitScript(mock);await pg.goto(FILE);await pg.waitForTimeout(400);return pg;}
  const pc=await device({width:1180,height:900});
  assert.match(await pc.locator('#dlg h2').innerText(),/센터 암호 정하기/);assert.equal(await pc.getAttribute('#pinIn','type'),'password');await pc.click('[data-act=pin-eye]');assert.equal(await pc.getAttribute('#pinIn','type'),'text');await pc.click('[data-act=pin-eye]');assert.equal(await pc.getAttribute('#pinIn','type'),'password');ok('암호는 가려지고 눈 단추로 보였다 가렸다');await pc.fill('#pinIn','2468');await pc.fill('#meIn','시설장');await pc.click('[data-act=pin-new]');await pc.waitForTimeout(400);
  assert.match(await pc.locator('#sync').innerText(),/구글 시트에 저장 중/);ok('PC: 로그인 없이 센터 암호 정하고 시작');
  await pc.click('[data-act=veh-new]');await pc.fill('#vName','스타렉스');await pc.fill('#vOdo','15484');await pc.click('[data-act=veh-save]');await pc.waitForTimeout(300);
  const ph=await device({width:390,height:800});
  assert.match(await ph.locator('#dlg h2').innerText(),/^센터 암호$/);await ph.fill('#pinIn','9999');await ph.click('[data-act=pin-ok]');await ph.waitForTimeout(300);assert.match(await ph.locator('#pinErr').innerText(),/맞지 않아요/);
  await ph.fill('#pinIn','2468');await ph.fill('#meIn','김선생');await ph.click('[data-act=pin-ok]');await ph.waitForTimeout(400);
  assert.match(await ph.locator('#view').innerText(),/스타렉스/);ok('휴대폰: 틀린 암호 거절, 맞는 암호로 같은 차량이 보임');
  await ph.click('[data-act=trip-new]');await ph.fill('#tDriver','김선생');await ph.selectOption('#tST_h','13');await ph.selectOption('#tST_m','30');await ph.selectOption('#tET_h','14');await ph.selectOption('#tET_m','00');await ph.fill('#tEnd','15500');await ph.click('[data-act=trip-save]');await ph.waitForTimeout(300);
  await pc.waitForTimeout(21000);
  assert.match(await pc.locator('.odo').getAttribute('aria-label'),/15,500/);await pc.click('#tab-log');assert.match(await pc.locator('tbody').innerText(),/김선생/);ok('휴대폰에서 적은 운행이 PC에 나타남 (20초 안)');
  assert.equal(M.sheets['운행일지'].rows[1][16],'김선생');ok('누가 적었는지 시트에 남음');
  // 인터넷이 끊겼다가 돌아옴
  down=true;await ph.click('[data-act=trip-new]');await ph.selectOption('#tST_h','18');await ph.selectOption('#tST_m','00');await ph.selectOption('#tET_h','18');await ph.selectOption('#tET_m','30');await ph.fill('#tEnd','15520');await ph.click('[data-act=trip-save]');await ph.waitForTimeout(400);
  assert.match(await ph.locator('#sync').innerText(),/보내지 못한 기록 2건/);assert.equal(M.sheets['운행일지'].rows.length,2);
  await ph.reload();await ph.waitForTimeout(300);assert.equal(await ph.evaluate(()=>CJ.outbox().length),2);
  down=false;await ph.reload();await ph.waitForTimeout(1500);
  assert.equal(await ph.evaluate(()=>CJ.outbox().length),0);assert.equal(M.sheets['운행일지'].rows.length,3);assert.match(await ph.locator('#sync').innerText(),/구글 시트에 저장 중/);ok('인터넷이 끊기면 보관했다가 다시 보냄');
  // 예시 넣기: 운행 14건이 한 번에 시트에 들어가야 한다
  const M2=require('./gasmock')();
  const c3=await b.newContext({viewport:{width:1000,height:800}});const ex=await c3.newPage();watch(ex);let calls=0;await ex.exposeFunction('gasApi',j=>{calls++;return M2.api.api(j);});await ex.addInitScript(mock);await ex.goto(FILE);await ex.waitForTimeout(400);
  await ex.fill('#pinIn','1357');await ex.click('[data-act=pin-new]');await ex.waitForTimeout(400);calls=0;await ex.click('[data-act=ex-add]');await ex.waitForTimeout(800);
  assert.equal(M2.sheets['운행일지'].rows.length-1,14);assert.equal(M2.sheets['정비기록'].rows.length-1,8);assert.ok(calls<=3,'calls '+calls);ok('구글 시트판 예시 넣기: 한 번에 저장 ('+calls+'번 호출)');
  // 의견 보내기
  assert.equal(await p.locator('#fbBtn').isHidden(),true);
  await ph.click('#fbBtn');await ph.click('[data-f=fEase][data-v="4"]');await ph.click('[data-f=fOld][data-v="1~3분"]');await ph.fill('#fConf','동승자 확인이 뭔지 몰랐어요');await ph.click('[data-act=fb-save]');await ph.waitForTimeout(500);
  const fr=M.sheets['의견'].rows[1];assert.equal(fr[3],4);assert.equal(fr[4],'1~3분');assert.equal(fr[5],'동승자 확인이 뭔지 몰랐어요');assert.ok(fr[10]>=0);ok('의견 보내기가 의견 시트에 쌓임');
  assert.ok(typeof M.sheets['운행일지'].rows[1][17]==='number');ok('운행 1건 작성 시간이 기록됨');
  await ph.screenshot({path:'shots/t_phone.png'});
  assert.deepEqual(errs,[]);console.log('브라우저 테스트 '+n+'개 통과');await b.close();
})().catch(e=>{console.error('실패:',e.message);process.exit(1)});
