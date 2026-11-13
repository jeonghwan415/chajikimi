// 소스(src/)를 묶어 세 가지 판을 만든다: node build.js
const fs=require('fs'),path=require('path');const src=f=>fs.readFileSync(path.join(__dirname,'src',f),'utf8');
const rules=src('rules.js');
const body=src('page.html').replace('/*@RULES*/',()=>rules).replace('/*@UI*/',()=>src('hwpx_base.js')+src('hwpx.js')+src('ui.js'));
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
fs.writeFileSync(path.join(__dirname,'build','demo','index.html'),doc.replace('<body>\n','<body>\n'+note+'\n'));
console.log('built',body.length,gs.length);
