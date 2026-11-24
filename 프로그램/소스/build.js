// 소스(src/)를 묶어 세 가지 판을 만든다: node build.js
const fs=require('fs'),path=require('path');const src=f=>fs.readFileSync(path.join(__dirname,'src',f),'utf8');
const rules=src('rules.js');
const VER='v4.3 (2026-11-24)';   // 고칠 때마다 올린다. 화면 맨 아래에 보여서 새 판이 배포됐는지 알 수 있다
const body=src('page.html').replace('/*@CC*/',()=>src('center-cloud.js')).replace('/*@VER*/',()=>VER).replace('/*@RULES*/',()=>rules).replace('/*@UI*/',()=>src('hwpx_base.js')+src('hwpx.js')+src('ui.js'));
fs.writeFileSync(path.join(__dirname,'app.html'),body);                       // Claude 웹 링크판 (게시용 본문)
const doc='<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'+body+'\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname,'build'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'build','차량지킴이.html'),doc);         // 파일판
fs.writeFileSync(path.join(__dirname,'build','index.html'),doc);
// 구글 시트판: Code.gs 하나에 규칙 + 서버 코드 + 화면(PAGE)을 모두 넣는다. 붙여 넣을 파일이 하나뿐이다.
const gs='/* 차량 지킴이 — 구글 시트판 (이 파일 하나만 붙여 넣으면 된다)\n   만든 사람: jeong hwan · 무단 배포 금지 (허락 없이 다른 곳에 나눠 주거나 고쳐 쓰지 마세요)\n   규칙 구역은 src/rules.js를 그대로 옮긴 것이다. 주기나 계산식은 src/rules.js에서 고치고 build.js를 돌린다. */\n'
  +rules+src('gas_tail.js')+'\n/* ============ 화면 (자동으로 만들어진 부분. 고치지 않는다) ============ */\nvar PAGE = '+JSON.stringify(doc).replace(/<\/script/g,'<\\/script')+';\n';
fs.writeFileSync(path.join(__dirname,'build','Code.gs'),gs);
// 테스트용 사이트(GitHub Pages): 파일판 + 맨 위 안내 띠. 기록은 여는 사람 기기에만 저장된다.
const note='<div style="background:#16233a;color:#fff;text-align:center;padding:10px 16px;font:500 15px/1.5 sans-serif">테스트용 사이트예요. 적은 기록은 <b>이 기기에만</b> 저장되고 센터 기록과 섞이지 않아요. 처음이면 <b>[예시로 먼저 살펴보기]</b>를 눌러 보세요.</div>';
fs.mkdirSync(path.join(__dirname,'build','demo'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'build','demo','index.html'),doc.replace('<body>\n','<body>\n<script>window.CC_DISABLED=true;</script>\n'+note+'\n'));   // 테스트용 사이트는 센터 계정을 끔

// ===== 체험판 (보여 주기용): 맨 위 표시 띠 + 사용 기한 + 인쇄·내보내기 표시 =====
// 기한과 이름은 여기서만 고친다. node build.js → build/trial/index.html
const TRIAL={who:'박정환',end:'2026-12-31',endText:'2026.12.31'};
TRIAL.line='체험판 · 만든 사람 '+TRIAL.who+' · 무단 배포 금지 · '+TRIAL.endText+'까지 사용 가능';
function patch(s,a,b){ if(s.indexOf(a)<0) throw new Error('체험판 패치 자리를 못 찾음: '+a.slice(0,40)); return s.replace(a,()=>b); }
let tb=body.replace(/\r\n/g,'\n');   // 윈도에서 받은 소스(CRLF)도 같은 자리를 찾도록
// 1) CSV 맨 위에 체험판 줄
tb=patch(tb,"function saveFile(name,text,type,okMsg){","function saveFile(name,text,type,okMsg){\n  if(window.TRIAL&&type==='text/csv'){var bom=text.charAt(0)==='\\ufeff'?'\\ufeff':''; text=bom+'\"'+TRIAL.line+'\"\\r\\n'+text.slice(bom.length);}");
// 2) 인쇄물: 아래쪽 표시 + 흐린 비스듬한 글씨
tb=patch(tb,"function printOut(html,css,fname,dir){","function printOut(html,css,fname,dir){\n  if(window.TRIAL){ html+='<div class=\"trialwm\">체험판</div><p class=\"trialft\">'+TRIAL.line+'</p>'; css+='.trialwm{position:fixed;top:40%;left:0;right:0;text-align:center;font:700 90pt sans-serif;color:rgba(0,0,0,.07);transform:rotate(-20deg);pointer-events:none}.trialft{font:9pt sans-serif;text-align:center;margin-top:4mm;color:#444}'; }");
// 3) 한글 파일: 표 아래 체험판 줄
tb=patch(tb,"  out+=hwpxTable(rows,w,hs,I.pLeft);\n  return out+'</hs:sec>';","  out+=hwpxTable(rows,w,hs,I.pLeft);\n  if(window.TRIAL) out+=hwpxPara(TRIAL.line,I.pLeft,I.cInfo);\n  return out+'</hs:sec>';");
// 4) 기한이 지나면 프로그램을 켜지 않는다
tb=patch(tb,"setSync(); render(); boot();","if(window.TRIAL_ENDED){ document.title='체험 기간이 끝났어요'; } else { setSync(); render(); boot(); }");
const guard='<script>(function(){var T=window.TRIAL='+JSON.stringify(TRIAL)+';var d=new Date(),t=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");if(t>T.end){window.TRIAL_ENDED=true;document.write(\'<style>body>*:not(#trialEnd){display:none!important}</style><div id="trialEnd" style="max-width:520px;margin:18vh auto;padding:32px 24px;text-align:center;font:500 17px/1.7 sans-serif;color:#16233a;border:2px solid #f5c400;border-radius:16px;background:#fffbe6"><div style="font-size:44px">🚐</div><b style="font-size:22px">체험 기간이 끝났어요</b><br>이 체험판은 \'+T.endText+\'까지 쓸 수 있었어요.<br>계속 쓰고 싶으시면 만든 사람(\'+T.who+\')에게 문의해 주세요.<br><small style="color:#667">적어 두신 기록은 이 기기 안에 그대로 남아 있어요.</small></div>\');}})();</script>';
const tbanner='<div id="trialBar" style="background:#f5c400;color:#16233a;text-align:center;padding:9px 16px;font:600 15px/1.5 sans-serif">체험판 · 만든 사람 '+TRIAL.who+' · 무단 배포 금지 · <b>'+TRIAL.endText+'까지</b> 사용할 수 있어요<br><span style="font-weight:500;font-size:13.5px">적은 기록은 이 기기에만 저장돼요. 처음이면 [예시로 먼저 살펴보기]를 눌러 보세요.</span></div>';
const tdoc='<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="robots" content="noindex">\n<title>차량 지킴이 (체험판)</title>\n<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'+'<script>window.CC_DISABLED=true;</script>\n'+guard+'\n'+tbanner+'\n'+tb+'\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname,'build','trial'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'build','trial','index.html'),tdoc);
console.log('built',body.length,gs.length);
