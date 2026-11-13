/* ============ 한글(HWPX) 파일 만들기 ============ */
// 한글 2014 이후 버전이 여는 .hwpx 파일을 브라우저에서 바로 만든다. 서버나 외부 라이브러리를 쓰지 않는다.
var HWPX_UNIT_MM=283.465;          // 1mm = 283.465 HWPUNIT
var HWPX_TEXT_W=77385;            // A4 가로, 좌우 여백 12mm일 때 글자 영역 너비
function hx(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
var hwpxSeq=1000;
function hwpxId(){return String(++hwpxSeq);}
// 문단 하나. lines를 주면 한 칸 안에서 줄을 나눈다.
function hwpxPara(text,paraId,charId){
  var lines=String(text==null?'':text).split('\n');
  return lines.map(function(t){return '<hp:p id="'+hwpxId()+'" paraPrIDRef="'+paraId+'" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="'+charId+'">'+(t?'<hp:t>'+hx(t)+'</hp:t>':'<hp:t/>')+'</hp:run></hp:p>';}).join('');
}
// 표 칸 하나
function hwpxCell(c,col,row,w,h){
  return '<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="'+(c.bf||HWPX_IDS.bLine)+'">'+
    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'+
    hwpxPara(c.t,c.p||HWPX_IDS.pCenter,c.c||HWPX_IDS.cNorm)+'</hp:subList>'+
    '<hp:cellAddr colAddr="'+col+'" rowAddr="'+row+'"/><hp:cellSpan colSpan="1" rowSpan="'+(c.rs||1)+'"/>'+
    '<hp:cellSz width="'+w+'" height="'+h+'"/><hp:cellMargin left="283" right="283" top="141" bottom="141"/></hp:tc>';
}
// 표. rows: [[{t,bf,p,c,rs,skip}...]], widths: HWPUNIT 배열, heights: 줄마다 높이
function hwpxTable(rows,widths,heights,paraId){
  var W=widths.reduce(function(a,b){return a+b;},0), H=heights.reduce(function(a,b){return a+b;},0);
  var body=rows.map(function(r,ri){
    return '<hp:tr>'+r.map(function(c,ci){ if(c.skip) return ''; var h=heights[ri]; if(c.rs>1) for(var k=1;k<c.rs;k++) h+=heights[ri+k]; return hwpxCell(c,ci,ri,widths[ci],h);}).join('')+'</hp:tr>';
  }).join('');
  return '<hp:p id="'+hwpxId()+'" paraPrIDRef="'+(paraId||HWPX_IDS.pLeft)+'" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="'+HWPX_IDS.cNorm+'">'+
    '<hp:tbl id="'+hwpxId()+'" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="'+rows.length+'" colCnt="'+widths.length+'" cellSpacing="0" borderFillIDRef="'+HWPX_IDS.bLine+'" noAdjust="0">'+
    '<hp:sz width="'+W+'" widthRelTo="ABSOLUTE" height="'+H+'" heightRelTo="ABSOLUTE" protect="0"/>'+
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'+
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="283" right="283" top="141" bottom="141"/>'+body+'</hp:tbl></hp:run></hp:p>';
}
// 비율로 준 너비를 글자 영역 너비에 맞춘다
function hwpxWidths(ratio,total){
  var sum=ratio.reduce(function(a,b){return a+b;},0), out=ratio.map(function(r){return Math.floor(total*r/sum);});
  out[out.length-1]+=total-out.reduce(function(a,b){return a+b;},0); return out;
}
// 운행일지 한 달 치를 한글 파일 내용(section0.xml)으로 만든다
function hwpxTripSection(vid,month){
  var I=HWPX_IDS, v=S.vehicles[vid], list=tripsOf(vid,month), total=0, kids=0;
  var appr=(S.settings.approvers||'담당자/시설장').split('/').map(function(s){return s.trim();}).filter(Boolean);
  var out=HWPX_SEC_HEAD;
  // 결재란 (오른쪽)
  var aw=[Math.round(7*HWPX_UNIT_MM)].concat(appr.map(function(){return Math.round(22*HWPX_UNIT_MM);}));
  var ar=[[{t:'결\n재',rs:2,bf:I.bHead,c:I.cBold}].concat(appr.map(function(a){return {t:a,bf:I.bHead,c:I.cBold};})),
          [{skip:true}].concat(appr.map(function(){return {t:''};}))];
  out+=hwpxTable(ar,aw,[Math.round(6*HWPX_UNIT_MM),Math.round(15*HWPX_UNIT_MM)],I.pRight);
  out+=hwpxPara('차량 운행일지',I.pCenter,I.cTitle);
  out+=hwpxPara((S.settings.center||'')+'   '+month.replace('-','년 ')+'월   차량: '+v.name+' '+(v.plate||'')+(isLocked(S,month)?'   (마감)':''),I.pLeft,I.cInfo);
  var head=['번호','일자','출발\n시간','도착\n시간','운행 목적','출발 km','도착 km','운행\n거리','운전자\n확인','동승자\n확인','차량 점검 내용','탑승\n아동','비고'];
  var w=hwpxWidths([8,15,11,11,22,15,15,12,18,18,55,9,24],HWPX_TEXT_W);
  var rows=[head.map(function(h){return {t:h,bf:I.bHead,c:I.cBold};})], hs=[Math.round(10*HWPX_UNIT_MM)];
  list.forEach(function(e,i){
    var t=e[1], d=t.endKm-t.startKm; total+=d; kids+=(+t.riders||0);
    rows.push([{t:i+1},{t:t.date.slice(5).replace('-','.')+'.'},{t:t.startTime||''},{t:t.endTime||''},{t:t.purpose+(t.dest?'\n'+t.dest:'')},
      {t:fmtKm(t.startKm),p:I.pRight},{t:fmtKm(t.endKm),p:I.pRight},{t:fmtKm(d),p:I.pRight},
      {t:t.driver+(t.drvOk?'\n(확인)':'')},{t:(t.guardian||'')+(t.guardian&&t.guardOk?'\n(확인)':'')},
      {t:checkText(t),p:I.pLeft},{t:t.riders||0},{t:t.memo||'',p:I.pLeft}]);
    hs.push(Math.round(9*HWPX_UNIT_MM));
  });
  for(var k=list.length;k<Math.max(list.length,10);k++){ rows.push(head.map(function(){return {t:''};})); hs.push(Math.round(9*HWPX_UNIT_MM)); }
  rows.push([{t:'합계',bf:I.bHead,c:I.cBold},{t:list.length+'회',bf:I.bHead,c:I.cBold}].concat([1,2,3,4,5].map(function(){return {t:'',bf:I.bHead};}))
    .concat([{t:fmtKm(total)+'km',bf:I.bHead,c:I.cBold,p:I.pRight},{t:'',bf:I.bHead},{t:'',bf:I.bHead},{t:'',bf:I.bHead},{t:kids+'명',bf:I.bHead,c:I.cBold},{t:'',bf:I.bHead}]));
  hs.push(Math.round(8*HWPX_UNIT_MM));
  out+=hwpxTable(rows,w,hs,I.pLeft);
  return out+'</hs:sec>';
}
/* ---- 압축하지 않는 ZIP 만들기 (한글 파일의 겉봉투) ---- */
var CRC_T=(function(){var t=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b){var c=0xFFFFFFFF;for(var i=0;i<b.length;i++)c=CRC_T[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function utf8(s){return new TextEncoder().encode(s);}
function zipStore(files){
  var parts=[], central=[], off=0;
  function u16(v){return [v&255,(v>>>8)&255];} function u32(v){return [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];}
  files.forEach(function(f){
    var name=utf8(f.name), data=f.data, crc=crc32(data);
    var local=[].concat([0x50,0x4b,0x03,0x04],u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0));
    parts.push(new Uint8Array(local),name,data);
    central.push(new Uint8Array([].concat([0x50,0x4b,0x01,0x02],u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off))),name);
    off+=local.length+name.length+data.length;
  });
  var csize=central.reduce(function(a,b){return a+b.length;},0);
  var end=new Uint8Array([].concat([0x50,0x4b,0x05,0x06],u16(0),u16(0),u16(files.length),u16(files.length),u32(csize),u32(off),u16(0)));
  var all=parts.concat(central,[end]), len=all.reduce(function(a,b){return a+b.length;},0), buf=new Uint8Array(len), p=0;
  all.forEach(function(a){buf.set(a,p);p+=a.length;}); return buf;
}
function b64bytes(s){var bin=atob(s), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u;}
function buildHwpx(vid,month){
  var B=HWPX_BASE, title='차량 운행일지 '+month, now=new Date().toISOString().replace(/\.\d+Z$/,'Z');
  var hpf=B['Contents/content.hpf'].replace('<opf:title/>','<opf:title>'+hx(title)+'</opf:title>').replace(/synthetic-fixture-author/g,hx(me||'차량 지킴이'))
    .replace(/(name="CreatedDate" content="text">)[^<]*/,'$1'+now).replace(/(name="ModifiedDate" content="text">)[^<]*/,'$1'+now).replace(/(name="date" content="text">)[^<]*/,'$1'+today());
  var files=[ // mimetype은 맨 앞에, 압축 없이 둔다 (한글 파일 규칙)
    {name:'mimetype',data:utf8(B['mimetype'])},{name:'version.xml',data:utf8(B['version.xml'])},
    {name:'Contents/header.xml',data:utf8(B['Contents/header.xml'])},{name:'Contents/section0.xml',data:utf8(hwpxTripSection(vid,month))},
    {name:'Preview/PrvText.txt',data:utf8(title)},{name:'settings.xml',data:utf8(B['settings.xml'])},{name:'Preview/PrvImage.png',data:b64bytes(HWPX_PRV_IMG)},
    {name:'META-INF/container.rdf',data:utf8(B['META-INF/container.rdf'])},{name:'Contents/content.hpf',data:utf8(hpf)},
    {name:'META-INF/container.xml',data:utf8(B['META-INF/container.xml'])},{name:'META-INF/manifest.xml',data:utf8(B['META-INF/manifest.xml'])}];
  return zipStore(files);
}
