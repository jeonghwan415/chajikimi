// 한글 파일 저장 테스트: node hwpxtest.js → build/test.hwpx
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({acceptDownloads:true})).newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('file://'+__dirname+'/build/index.html');await p.waitForTimeout(400);await p.click('[data-act=ex-add]');await p.waitForTimeout(200);
 await p.click('#tab-log');
 await p.click('#fileMenu summary');
 const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-act=hwpx]')]);
 await dl.saveAs(__dirname+'/build/test.hwpx');console.log('saved',dl.suggestedFilename(),'errors',errs);await b.close();})();
