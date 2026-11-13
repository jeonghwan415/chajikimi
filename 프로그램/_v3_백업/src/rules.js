/* ============ 1. 규칙 (AI 없이 계산) — 이 파일이 계산식의 유일한 원본이다 ============ */
// 점검 항목과 기본 주기. 일반 권장값이며 차량 취급설명서가 우선한다. 설정에서 차량별로 고칠 수 있다.
// ev:false 인 항목은 전기차에서 숨긴다.
var ITEMS=[
 {k:'oil',   n:'엔진오일', full:'엔진오일·오일필터', km:10000, mo:12, skm:5000, smo:6, ev:false, tip:'엔진 속 부품이 닳지 않게 해 주는 기름'},
 {k:'airf',  n:'공기 필터', full:'에어클리너(공기 필터)', km:20000, mo:24, skm:10000, smo:12, ev:false, tip:'엔진으로 들어가는 공기의 먼지를 거름'},
 {k:'cabin', n:'에어컨 필터', full:'에어컨 필터', km:15000, mo:12, tip:'차 안으로 들어오는 공기를 거름. 아이들 호흡기와 관련'},
 {k:'rot',   n:'타이어 위치', full:'타이어 위치 교환', km:10000, mo:0, tip:'앞뒤 타이어 자리를 바꿔 고르게 닳게 함'},
 {k:'tire',  n:'타이어 교체', full:'타이어 교체', km:50000, mo:60, tip:'홈 깊이 1.6mm 아래면 바로 교체'},
 {k:'pad',   n:'브레이크 패드', full:'브레이크 패드', km:40000, mo:0, tip:'차를 세우는 부품. 끽 소리가 나면 바로 점검'},
 {k:'bfluid',n:'브레이크액', full:'브레이크액', km:40000, mo:24, tip:'브레이크 힘을 전달하는 액체'},
 {k:'cool',  n:'냉각수', full:'냉각수(부동액)', km:40000, mo:24, tip:'엔진이나 배터리가 과열되지 않게 식혀 줌'},
 {k:'batt',  n:'배터리', full:'배터리(시동용)', km:60000, mo:36, tip:'시동을 거는 전기. 겨울 전에 점검'},
 {k:'atf',   n:'변속기 오일', full:'변속기 오일', km:100000, mo:0, ev:false, tip:'변속기를 부드럽게 해 주는 기름'},
 {k:'wiper', n:'와이퍼', full:'와이퍼', km:0, mo:12, tip:'줄이 생기거나 소리가 나면 교체'}
];
var FUELS=['경유','휘발유','LPG','전기'];
var PURPOSES=['등원','하원','체험활동','병원 동행','업무','기타'];
var SOON_DAYS=30;
// 운행일지의 차량점검내용. pre:true는 운행 전, false는 운행 후에 보는 것.
var CHECKS=[{k:'tire',n:'타이어',pre:true},{k:'lamp',n:'전조등·방향지시등',pre:true},{k:'belt',n:'안전띠',pre:true},{k:'door',n:'차 문',pre:true},{k:'sleep',n:'하차확인장치',pre:true},{k:'off',n:'운행 후 하차 확인',pre:false}];
// 예전 기록(운행 전 점검/하차 확인 두 칸)도 같은 모양으로 읽는다
function checksOf(t){
  if(t.checks) return t.checks;
  var out=[]; CHECKS.forEach(function(c){ if(c.pre?t.pre:t.post) out.push(c.k); }); return out;
}
function checkText(t){
  var have=checksOf(t), miss=CHECKS.filter(function(c){return have.indexOf(c.k)<0;}).map(function(c){return c.n;});
  var s=miss.length===0?'이상 없음 ('+CHECKS.length+'항목 점검)':have.length===0?'점검 안 함':'점검 '+have.length+'/'+CHECKS.length+' · 안 본 것: '+miss.join(', ');
  return s+(t.checkNote?' · '+t.checkNote:'');
}
// 철마다 챙길 것. 일반적인 관리 요령이며 차량 설명서와 정비소 안내가 우선한다.
var SEASONS=[
 {m:[12,1,2],name:'겨울철',line:'추운 아침에는 시동이 잘 안 걸릴 수 있어요. 배터리와 부동액을 봐 주세요.',items:['배터리: 3년이 넘었으면 정비소에서 상태를 재 보세요','부동액(냉각수): 양이 눈금 사이에 있는지 보세요','타이어: 공기압이 낮아지기 쉬워요. 홈이 얕으면 눈길에 미끄러져요','워셔액: 겨울용(얼지 않는 것)으로 채워 주세요','앞 유리 성에: 출발 5분 전에 히터를 틀어 시야를 확보하세요','눈·얼음이 있는 날은 평소보다 일찍 출발하고 천천히 다녀요']},
 {m:[3,4,5],name:'봄철',line:'황사와 꽃가루가 많은 때예요. 에어컨 필터를 봐 주세요.',items:['에어컨 필터: 아이들 호흡기를 위해 봄에 한 번 갈아 주세요','세차: 겨울에 묻은 제설제(염화칼슘)를 차 아래까지 씻어 내세요','와이퍼: 겨울을 지나며 고무가 굳었는지 보세요','타이어: 공기압을 다시 맞춰 주세요']},
 {m:[6,7],name:'장마철',line:'비가 많이 오는 때예요. 와이퍼와 타이어 홈을 봐 주세요.',items:['와이퍼: 줄이 생기거나 소리가 나면 갈아 주세요','타이어: 홈이 얕으면 빗길에 미끄러져요 (1.6mm 아래면 교체)','전조등·브레이크등: 비 오는 날은 낮에도 켜요. 불이 다 들어오는지 보세요','앞 유리 김 서림: 에어컨을 앞 유리 쪽으로 틀어요','물이 고인 길은 돌아가고, 빗길에서는 속도를 줄여요','에어컨 필터: 눅눅한 냄새가 나면 갈아 주세요']},
 {m:[8],name:'한여름',line:'더위에 엔진이 뜨거워지기 쉬워요. 냉각수와 에어컨을 봐 주세요.',items:['냉각수: 양이 눈금 사이에 있는지 보세요. 계기판 온도 바늘이 올라가면 바로 세워요','에어컨: 바람이 시원하지 않으면 정비소에 가요','타이어: 뜨거운 길에서는 공기압이 중요해요','차 안에 아이가 남지 않았는지 꼭 확인해요. 여름 차 안은 금방 뜨거워져요']},
 {m:[9,10,11],name:'가을철',line:'겨울이 오기 전에 미리 챙겨 두면 편해요. 배터리와 히터를 봐 주세요.',items:['배터리: 추워지기 전에 정비소에서 상태를 재 보세요','히터: 따뜻한 바람이 잘 나오는지 틀어 보세요','부동액(냉각수): 2년이 넘었으면 정비소에 물어보세요','타이어: 홈 깊이와 공기압을 봐 주세요','해가 일찍 져요. 전조등이 다 들어오는지 보세요']}
];
function seasonOf(dateStr){var m=+String(dateStr).split('-')[1]; for(var i=0;i<SEASONS.length;i++) if(SEASONS[i].m.indexOf(m)>=0) return SEASONS[i]; return SEASONS[0];}
// 노란 차 캐릭터 '노랑이'가 하는 말
function mascotSay(al){
  var over=al.filter(function(a){return a.st==='over';}), soon=al.filter(function(a){return a.st==='soon';}), ok=al.filter(function(a){return a.st==='ok';});
  function names(x){return x.slice(0,2).map(function(a){return a.name;}).join(', ')+(x.length>2?' 등':'');}
  if(over.length) return {mood:'over',head:'점검할 시기가 지났어요. 신경 써 주세요!',sub:names(over)+(over.length>1?'을(를) 먼저':'부터')+' 챙겨 주세요.'+(soon.length?' 곧 챙길 것도 '+soon.length+'가지 있어요.':'')};
  if(soon.length) return {mood:'soon',head:'점검할 시기예요. 신경 써 주세요!',sub:names(soon)+' 차례가 다가오고 있어요.'};
  if(ok.length) return {mood:'ok',head:'지금은 모두 괜찮아요. 고마워요!',sub:'운행하고 나서 기록만 남겨 주세요.'};
  return {mood:'unk',head:'아직 제 정비 기록이 없어요.',sub:'마지막으로 교환한 날을 알려 주시면 다음 시기를 챙겨 드릴게요.'};
}
function soonKm(interval){return Math.min(2000,Math.max(500,Math.round(interval*0.1)));}
function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function today(){return ymd(new Date());}
function parseD(s){var p=String(s).split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
function addMonths(s,m){var d=parseD(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+m);var last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return ymd(d);}
function addDays(s,n){var d=parseD(s);d.setDate(d.getDate()+n);return ymd(d);}
function daysBetween(a,b){return Math.round((parseD(b)-parseD(a))/86400000);}
function fmtKm(n){return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function fmtD(s){if(!s)return '';var p=s.split('-');return p[0]+'.'+p[1]+'.'+p[2]+'.';}
function fmtMD(s){var p=s.split('-');return (+p[1])+'월 '+(+p[2])+'일';}
function vals(o){return Object.keys(o||{}).map(function(k){return o[k];});}
function itemsFor(v){return ITEMS.filter(function(it){return !(v&&v.fuel==='전기'&&it.ev===false);});}
function intervalOf(v,it){
  var o=(v.intervals||{})[it.k];
  if(o) return {km:+o.km||0, mo:+o.mo||0};
  if(v.severe && it.skm) return {km:it.skm, mo:it.smo};
  return {km:it.km, mo:it.mo};
}
// 현재 주행거리 = 등록한 계기판 숫자, 차량에 적어 둔 최신 km(odo), 운행일지 도착 km, 정비 기록 km 중 가장 큰 값
function odoOf(S,vid){
  var v=S.vehicles[vid]||{}, m=Math.max(+v.baseOdo||0,+v.odo||0);
  vals(S.trips).forEach(function(t){if(t.vid===vid&&+t.endKm>m)m=+t.endKm;});
  vals(S.services).forEach(function(s){if(s.vid===vid&&+s.km>m)m=+s.km;});
  return m;
}
// 최근 30일 하루 평균 주행거리 (예상 날짜 계산용). 기록이 7일 치보다 적으면 0.
function dailyKm(S,vid,now){
  var from=addDays(now,-30), sum=0, first=null;
  vals(S.trips).forEach(function(t){ if(t.vid===vid&&t.date>=from&&t.date<=now){sum+=(+t.endKm)-(+t.startKm); if(!first||t.date<first)first=t.date;} });
  if(!first||daysBetween(first,now)<7) return 0;
  return sum/Math.max(1,daysBetween(first,now)+1);
}
function lastService(S,vid,k){
  var best=null;
  vals(S.services).forEach(function(s){ if(s.vid===vid&&s.item===k&&(!best||s.date>best.date||(s.date===best.date&&(+s.km||0)>(+best.km||0)))) best=s; });
  return best;
}
// 한 항목의 상태를 계산한다. 근거(why) 문장을 함께 만든다.
function itemStatus(S,vid,it,now){
  var v=S.vehicles[vid], iv=intervalOf(v,it), last=lastService(S,vid,it.k), odo=odoOf(S,vid);
  var src=v.ivChecked?'차량 설명서로 확인한 주기':'일반 권장 주기';
  if(!last) return {st:'unk', label:'기록 없음', why:'마지막으로 교환한 날을 아직 적지 않았어요. 정비소 스티커나 명세서를 보고 적어 주세요.', iv:iv, ratio:0, src:src};
  var parts=[], st='ok', ratio=0, kmLeft=null, dLeft=null, dueD=null, estD=null;
  if(iv.km>0 && +last.km>0){
    var due=+last.km+iv.km; kmLeft=due-odo; ratio=Math.max(ratio,(odo-last.km)/iv.km);
    parts.push('마지막 교환 '+fmtKm(last.km)+'km + 주기 '+fmtKm(iv.km)+'km = '+fmtKm(due)+'km, 지금 '+fmtKm(odo)+'km');
    if(kmLeft<0) st='over'; else if(kmLeft<=soonKm(iv.km)) st='soon';
    var dk=dailyKm(S,vid,now); if(dk>0&&kmLeft>=0) estD=addDays(now,Math.round(kmLeft/dk));
  }
  if(iv.mo>0){
    dueD=addMonths(last.date,iv.mo); dLeft=daysBetween(now,dueD);
    ratio=Math.max(ratio,daysBetween(last.date,now)/Math.max(1,daysBetween(last.date,dueD)));
    parts.push('마지막 교환 '+fmtD(last.date)+' + '+iv.mo+'개월 = '+fmtD(dueD));
    if(dLeft<0) st='over'; else if(dLeft<=SOON_DAYS && st!=='over') st='soon';
  }
  var label;
  if(st==='over'){ label=(kmLeft!==null&&kmLeft<0)?fmtKm(-kmLeft)+'km 지남':(-dLeft)+'일 지남'; }
  else { var a=[]; if(kmLeft!==null)a.push(fmtKm(kmLeft)+'km 남음'); if(dLeft!==null)a.push(dLeft+'일 남음'); label=a.join(' · ')||'기록됨'; }
  if(iv.km>0 && !(+last.km>0)) parts.push('교환 때 km를 적지 않아 날짜로만 계산');
  // 달력에 넣을 날짜: 날짜 기한과 km 예상일 중 빠른 쪽
  var when=dueD; if(estD&&(!when||estD<when)) when=estD;
  return {st:st,label:label,why:parts.join(' / '),iv:iv,ratio:ratio,last:last,kmLeft:kmLeft,dLeft:dLeft,estD:estD,when:when,src:src};
}
// 날짜로만 보는 항목 (정기검사, 보험, 안전교육)
function dateStatus(due,now){
  if(!due) return {st:'unk',label:'날짜 없음'};
  var d=daysBetween(now,due);
  return {st:d<0?'over':(d<=SOON_DAYS?'soon':'ok'), label:d<0?(-d)+'일 지남':d+'일 남음', dLeft:d};
}
function driversOf(S){
  return Object.keys(S.drivers||{}).map(function(id){var d=S.drivers[id];return {id:id,name:d.name,edu:d.edu,ts:d.ts||0};}).sort(function(a,b){return a.ts-b.ts;});
}
function allAlerts(S,vid,now){
  var out=[], v=S.vehicles[vid]; if(!v) return out;
  itemsFor(v).forEach(function(it){var r=itemStatus(S,vid,it,now); out.push({kind:'item',key:it.k,name:it.n,full:it.full,tip:it.tip,st:r.st,label:r.label,why:r.why,ratio:r.ratio,estD:r.estD,when:r.when,src:r.src,iv:r.iv});});
  var a=dateStatus(v.inspDate,now); out.push({kind:'insp',key:'insp',name:'정기검사',full:'자동차 정기검사',tip:'자동차등록증에 적힌 검사 유효기간',st:a.st,label:a.label,when:v.inspDate||null,ratio:a.st==='unk'?0:Math.min(1,1-a.dLeft/365),why:v.inspDate?'검사 유효기간 만료일 '+fmtD(v.inspDate)+' (자동차등록증에 적힌 날짜)':'자동차등록증의 검사 유효기간 만료일을 적어 주세요.'});
  var b=dateStatus(v.insDate,now); out.push({kind:'ins',key:'ins',name:'보험 만기',full:'자동차 보험 만기',tip:'보험증권에 적힌 끝 날짜',st:b.st,label:b.label,when:v.insDate||null,ratio:b.st==='unk'?0:Math.min(1,1-b.dLeft/365),why:v.insDate?'보험 만기일 '+fmtD(v.insDate):'보험증권의 만기일을 적어 주세요.'});
  driversOf(S).forEach(function(d){
    var due=d.edu?addMonths(d.edu,24):''; var c=dateStatus(due,now);
    out.push({kind:'edu',key:'edu:'+d.id,name:d.name+' 안전교육',full:d.name+' 선생님 통학버스 안전교육',tip:'2년마다 다시 받는 교육 (주기는 관할 안내로 확인)',st:c.st,label:c.label,when:due||null,ratio:c.st==='unk'?0:Math.min(1,1-c.dLeft/730),why:d.edu?'마지막 교육 '+fmtD(d.edu)+' + 2년 = '+fmtD(due):'마지막 교육 받은 날을 적어 주세요.'});
  });
  var rank={over:0,soon:1,unk:3,ok:2};
  out.forEach(function(x,i){x.i=i;});
  out.sort(function(x,y){return rank[x.st]-rank[y.st]||y.ratio-x.ratio||x.i-y.i;});
  return out;
}
// 한 차량의 운행을 날짜·km 순으로 놓고, 앞 기록의 도착 km와 출발 km가 다른 기록을 찾는다.
function gaps(S,vid){
  var list=Object.keys(S.trips).filter(function(id){return S.trips[id].vid===vid;}).map(function(id){return {id:id,t:S.trips[id]};});
  list.sort(function(a,b){return a.t.date<b.t.date?-1:a.t.date>b.t.date?1:(+a.t.startKm)-(+b.t.startKm);});
  var out={};
  for(var i=1;i<list.length;i++){ var d=(+list[i].t.startKm)-(+list[i-1].t.endKm); if(d!==0) out[list[i].id]=d; }
  return out;
}
function isLocked(S,month){return ((S.settings||{}).locks||[]).indexOf(month)>=0;}
