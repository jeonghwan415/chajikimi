/* ============ 2. 저장소 (세 가지 중 하나를 자동으로 고른다) ============ */
var SCHEMA=2;
var DEF_SET={center:'',approvers:'담당자/시설장',locks:[],emails:''};
var S={vehicles:{},trips:{},services:{},drivers:{},feedback:{},settings:Object.assign({},DEF_SET)};
var COLLS=['vehicles','trips','services','drivers'];
var store={mode:'loading'};
var LS={get:function(k,d){try{var v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
var outbox=LS.get('cj.outbox',[]);          // 보내지 못한 기록. 인터넷이 돌아오면 다시 보낸다.
var me=LS.get('cj.me','');                   // 이 기기를 쓰는 사람 이름 (누가 적었는지 남기는 데 씀)
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function setSync(){
  var el=document.getElementById('sync'), t={loading:['','불러오는 중…'],cloud:['on','PC·휴대폰 함께 저장 중'],sheet:['on','구글 시트에 저장 중'],local:['local','이 기기에만 저장'],center:['on','센터 계정에 저장 중']}[store.mode];
  // v4.3 파일판·센터 계정판은 [센터 계정] 단추가 저장 상태를 함께 보여 줌. 구글 시트판·Claude 링크판은 예전 표시 그대로
  var chip=document.getElementById('ccChip'), useChip=!!(window.CC&&!window.CC_DISABLED&&(store.mode==='local'||store.mode==='center'||store.mode==='loading'));
  if(chip){ chip.hidden=!useChip; el.hidden=useChip; }
  if(store.mode==='center'&&window.CC) CC.setStatus(outbox.length?(navigator.onLine===false?'offline':'pending'):'ok', outbox.length);
  if(outbox.length&&store.mode!=='local') t=['local','보내지 못한 기록 '+outbox.length+'건 · 다시 보내는 중'];
  el.className='sync '+t[0]; el.lastElementChild.textContent=t[1];
  var fb=document.getElementById('fbBtn'); if(fb) fb.hidden=!(store.mode==='sheet'||store.mode==='cloud');
}
function applyOp(op){ if(op.c==='settings'){ if(op.data)S.settings=Object.assign({},DEF_SET,op.data); } else if(op.data) S[op.c][op.id]=op.data; else delete S[op.c][op.id]; }
function setAll(d){
  COLLS.forEach(function(c){S[c]=d[c]||{};}); S.settings=Object.assign({},DEF_SET,d.settings||{});
  outbox.forEach(applyOp);   // 아직 못 보낸 기록은 화면에 그대로 둔다
  migrate();
}
// 예전 형식(설정 안의 운전자 목록)을 운전자 문서로 옮긴다
function migrate(){
  var old=S.settings.drivers; if(!old||!old.length) return;
  if(!Object.keys(S.drivers).length) old.forEach(function(d,i){put('drivers',newId(),{name:d.name,edu:d.edu||'',ts:Date.now()+i});});
  var st=Object.assign({},S.settings); delete st.drivers; put('settings','center',st);
}
function queue(op){ outbox.push(op); LS.set('cj.outbox',outbox); setSync(); }
function flush(){
  if(!outbox.length||!store.raw||flush.busy) return; flush.busy=true;
  var op=outbox[0];
  store.raw(op).then(function(){ outbox.shift(); LS.set('cj.outbox',outbox); flush.busy=false; setSync(); if(outbox.length) flush(); else toast('보내지 못했던 기록을 모두 저장했어요.'); },
    function(){ flush.busy=false; });
}
function send(op){
  if(!store.raw) return;
  if(outbox.length){ queue(op); flush(); return; }   // 순서를 지키려고 밀린 것 뒤에 줄 세운다
  store.raw(op).catch(function(e){
    if(e&&e.retry){ queue(op); toast('인터넷이 약해요. 이 기기에 보관했다가 연결되면 다시 보낼게요.'); }
    else toast((e&&e.msg)||'저장하지 못했어요. 보기 전용 권한일 수 있어요.');
  });
}
function put(c,id,data){ applyOp({c:c,id:id,data:data}); send({c:c,id:id,data:data}); }
// 여러 건을 한꺼번에 저장한다. 구글 시트판은 50건씩 묶어 한 번에 보낸다.
function putMany(items,done){
  items.forEach(function(it){applyOp(it);});
  if(store.mode!=='sheet'){ items.forEach(function(it){send(it);}); if(done)done(items.length,0); return; }
  var chunks=[]; for(var i=0;i<items.length;i+=50) chunks.push(items.slice(i,i+50));
  var ok=0, bad=0;
  (function next(k){
    if(k>=chunks.length){ if(done)done(ok,bad); return; }
    gcall({op:'putMany',items:chunks[k]}).then(function(r){ ok+=r.done; bad+=r.failed.length; next(k+1); },
      function(e){ if(e&&e.retry){ chunks[k].forEach(queue); flush(); } else bad+=chunks[k].length; next(k+1); });
  })(0);
}
function del(c,id){ applyOp({c:c,id:id,data:null}); send({c:c,id:id,data:null}); }

/* --- v4.3 센터 계정판 (Supabase): 기록 하나 = 서버의 한 줄(c/id). 받은 것은 이 기기에 보관해서 인터넷이 끊겨도 보임 --- */
var cen=null;
function useCenter(){
  var c=CC.center(); cen=LS.get('cj.center',null);
  if(!cen||cen.center!==c.id) cen={center:c.id,since:null,rows:{}};
  function save(){ LS.set('cj.center',cen); }
  function build(){
    var d={vehicles:{},trips:{},services:{},drivers:{},settings:{}};
    Object.keys(cen.rows).forEach(function(k){ var i=k.indexOf('/'), col=k.slice(0,i), id=k.slice(i+1), v=cen.rows[k]; if(v==null||!/^[\w.:-]{1,100}$/.test(id)) return; if(col==='settings') d.settings=v; else if(d[col]) d[col][id]=v; });
    if(!d.settings.center) d.settings.center=c.name;
    setAll(d);
  }
  build();
  store={mode:'center', raw:function(op){
    var key=op.c==='settings'?'settings/center':op.c+'/'+op.id;
    return CC.push('chajikimi',[{key:key,value:op.data||null}]).then(function(){ cen.rows[key]=op.data||null; save(); CC.setStatus(outbox.length?'pending':'ok',outbox.length); },
      function(e){ if(e&&e.retry){ CC.setStatus('offline',outbox.length+1); throw {retry:true}; } throw {msg:(e&&e.msg)||'저장하지 못했어요.'}; });
  }};
  function pull(){
    if(flush.busy) return;
    var since=cen.since?new Date(new Date(cen.since).getTime()-3000).toISOString():null;
    CC.pull('chajikimi',since).then(function(rows){
      var who={}, uid=(CC.user()||{}).id;
      rows.forEach(function(r){ cen.rows[r.key]=r.value; if(!cen.since||r.updated_at>cen.since) cen.since=r.updated_at; if(r.updated_by&&r.updated_by!==uid&&r.updated_name) who[r.updated_name]=1; });
      save(); if(rows.length){ build(); if(canRedraw()) render(); }
      if(Object.keys(who).length&&since) toast(Object.keys(who).join(', ')+' 선생님이 고친 기록을 받았어요.');
      CC.setStatus(outbox.length?'pending':'ok',outbox.length); flush();
    },function(e){ CC.setStatus(e&&e.offline?'offline':'error',outbox.length,e&&e.msg); });
  }
  setSync(); render(); pull(); setInterval(function(){ if(!document.hidden) pull(); },20000); setInterval(flush,30000);
  window.addEventListener('online',function(){ flush(); pull(); }); window.addEventListener('focus',pull);
}
// 센터에 처음 들어올 때: 이 기기(파일판) 기록을 센터에 합칠지 묻는다. 이 기기 기록(cj.data)은 지우지 않고 그대로 둔다
function centerEnter(){
  var d=LS.get('cj.data',null), items=[];
  if(d) ['vehicles','trips','services','drivers'].forEach(function(c){ Object.keys(d[c]||{}).forEach(function(id){ items.push({key:c+'/'+id,value:d[c][id]}); }); });
  if(!items.length){ location.reload(); return; }
  CC.ask('이 기기에 있던 기록','<p>이 기기에 <b>'+items.length+'건</b>의 기록(차량·운행·정비·운전자)이 있어요. <b>'+esc(CC.center().name)+'</b> 기록에 합칠까요?</p><ul class="cc-list"><li><b>합치기</b>: 센터 선생님들이 함께 봐요.</li><li><b>합치지 않기</b>: 이 기기 기록은 그대로 두고(로그아웃하면 다시 보여요), 센터 기록만 봐요.</li></ul>',
    [{t:'합치기',v:'merge',main:true},{t:'합치지 않기',v:'keep'}]).then(function(v){
    if(v!=='merge'){ location.reload(); return; }
    CC.pull('chajikimi',null).then(function(rows){
      var hasSet=rows.some(function(r){return r.key==='settings/center'&&r.value;});
      if(!hasSet&&d.settings) items.push({key:'settings/center',value:d.settings});
      return CC.push('chajikimi',items);
    }).then(function(){ toast('이 기기 기록을 센터에 합쳤어요.'); setTimeout(function(){location.reload();},700); },function(e){ toast((e&&e.msg)||'합치지 못했어요. 다시 해 주세요.'); });
  });
}
function useLocal(){
  var d=LS.get('cj.data',null); outbox=[]; if(d) setAll(d);
  store={mode:'local', raw:function(){ LS.set('cj.data',{schema:SCHEMA,vehicles:S.vehicles,trips:S.trips,services:S.services,drivers:S.drivers,settings:S.settings}); return Promise.resolve(); }};
  migrate(); setSync(); render();
}
/* --- 구글 시트판: 서버 함수 api() 하나만 부른다. 로그인 대신 센터 암호를 쓴다. --- */
var pin=LS.get('cj.pin','');
function gcall(req){
  return new Promise(function(res,rej){
    req.pin=pin; req.by=me;
    google.script.run.withSuccessHandler(function(json){ var r=JSON.parse(json); if(r.ok) res(r.data); else rej({code:r.err,msg:r.msg}); })
      .withFailureHandler(function(){ rej({retry:true}); }).api(JSON.stringify(req));
  });
}
// 암호 칸: 처음에는 ●●●●로 가리고, 오른쪽 눈 단추를 누르면 보인다
function pinBox(id){ return '<div class="pinbox"><input class="in km" type="password" id="'+id+'" inputmode="numeric" autocomplete="off"><button type="button" class="eye" data-act="pin-eye" data-v="'+id+'" aria-label="암호 보이기" aria-pressed="false">'+EYE[0]+'</button></div>'; }
var EYE=['<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
 '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'];
function useSheet(){
  store={mode:'loading'};
  function start(){
    store={mode:'sheet', raw:function(op){ return gcall(op.data?{op:'put',c:op.c,id:op.id,data:op.data}:{op:'del',c:op.c,id:op.id}).catch(function(e){ if(e.code==='pin'){askPin('암호가 바뀌었어요. 새 센터 암호를 적어 주세요.');} throw e; }); }};
    setSync(); pull(); setInterval(pull,20000); setInterval(flush,30000); window.addEventListener('online',flush);
  }
  function pull(){ if(flush.busy) return; gcall({op:'getAll'}).then(function(d){ setAll(d); if(canRedraw()) render(); flush(); }, function(e){ if(e.code==='pin') askPin('센터 암호가 맞지 않아요.'); }); }
  function askPin(msg){
    openDlg('<header><h2>센터 암호</h2></header><div class="body"><p>'+esc(msg||'이 센터의 기록을 보려면 센터 암호를 적어 주세요. 한 번 적으면 이 기기가 기억해요.')+'</p>'+
      '<div class="field"><label for="pinIn">센터 암호</label>'+pinBox('pinIn')+'</div>'+
      '<div class="field"><label for="meIn">내 이름 <span class="muted small">(누가 적었는지 남겨요)</span></label><input class="in" id="meIn" value="'+esc(me)+'"></div><div id="pinErr" role="alert"></div></div>'+
      '<footer><button type="button" class="btn main" data-act="pin-ok">들어가기</button></footer>');
  }
  function newPin(){
    openDlg('<header><h2>센터 암호 정하기</h2></header><div class="body"><p>처음 여셨네요. 우리 센터 선생님만 쓸 수 있게 <b>센터 암호</b>를 정해 주세요. 다른 선생님에게는 이 주소와 암호를 함께 알려 주시면 돼요.</p>'+
      '<div class="field"><label for="pinIn">센터 암호 (숫자 4자리 이상)</label>'+pinBox('pinIn')+'</div>'+
      '<div class="field"><label for="meIn">내 이름</label><input class="in" id="meIn" value="'+esc(me)+'"></div><div id="pinErr" role="alert"></div></div>'+
      '<footer><button type="button" class="btn main" data-act="pin-new">정하고 시작하기</button></footer>');
  }
  window.pinFlow={
    ok:function(){ pin=$('pinIn').value.trim(); me=$('meIn').value.trim(); LS.set('cj.me',me);
      gcall({op:'getAll'}).then(function(d){ LS.set('cj.pin',pin); setAll(d); closeDlg(); if(store.mode!=='sheet') start(); }, function(e){ $('pinErr').innerHTML='<div class="err">'+(e.code==='lock'?'여러 번 틀려서 10분 동안 잠겼어요.':e.retry?'인터넷 연결을 확인해 주세요.':'암호가 맞지 않아요.')+'</div>'; }); },
    make:function(){ var p=$('pinIn').value.trim(); if(!/^\d{4,}$/.test(p)){ $('pinErr').innerHTML='<div class="err">숫자 4자리 이상으로 적어 주세요.</div>'; return; }
      me=$('meIn').value.trim(); LS.set('cj.me',me); pin='';
      gcall({op:'setPin',newPin:p}).then(function(){ pin=p; LS.set('cj.pin',pin); closeDlg(); start(); toast('센터 암호를 정했어요.'); }, function(e){ $('pinErr').innerHTML='<div class="err">'+(e.retry?'인터넷 연결을 확인해 주세요.':'이미 암호가 정해져 있어요. 화면을 새로 고쳐 주세요.')+'</div>'; }); }
  };
  gcall({op:'status'}).then(function(st){
    if(!st.hasPin) newPin(); else if(!pin) askPin(); else gcall({op:'getAll'}).then(function(d){ setAll(d); start(); }, function(e){ if(e.code==='pin'||e.code==='lock') askPin(e.code==='lock'?'여러 번 틀려서 잠시 잠겼어요. 10분 뒤에 다시 적어 주세요.':'센터 암호가 맞지 않아요.'); else { start(); } });
  }, function(){ toast('구글 시트에 연결하지 못했어요. 인터넷을 확인해 주세요.'); });
}
/* --- Claude 웹 링크판: 운행 기록은 최근 45일과 보고 있는 달만 읽는다 (기록이 많아져도 느려지지 않게) --- */
var cloud={recent:{},month:{},unsubMonth:null,db:null};
function useCloud(db){
  cloud.db=db;
  var got=false, timer=setTimeout(function(){ if(!got) toast('저장소 응답이 늦어요. 잠시 뒤 다시 열어 주세요.'); },10000);
  function redraw(){ got=true; clearTimeout(timer); S.trips=Object.assign({},cloud.month,cloud.recent); outbox.forEach(applyOp); if(canRedraw()) render(); }
  function snapMap(snap){ var o={}; snap.docs.forEach(function(d){o[d.id]=d.data();}); return o; }
  ['vehicles','services','drivers'].forEach(function(c){ db.collection(c).limit(1000).onSnapshot(function(snap){ S[c]=snapMap(snap); redraw(); }, function(){}); });
  db.collection('trips').where('date','>=',addDays(today(),-45)).limit(1000).onSnapshot(function(snap){ cloud.recent=snapMap(snap); redraw(); }, function(){});
  db.doc('settings/center').onSnapshot(function(d){ S.settings=Object.assign({},DEF_SET,d.exists?d.data():{}); migrate(); redraw(); }, function(){});
  cloud.watchMonth=function(m){
    if(cloud.unsubMonth){cloud.unsubMonth();cloud.unsubMonth=null;} cloud.month={};
    if(m+'-31'<addDays(today(),-45)) cloud.unsubMonth=db.collection('trips').where('date','>=',m+'-01').where('date','<=',m+'-31').limit(1000).onSnapshot(function(snap){ cloud.month=snapMap(snap); redraw(); }, function(){});
    else redraw();
  };
  store={mode:'cloud', raw:function(op){
    var ref=op.c==='settings'?db.doc('settings/center'):db.collection(op.c).doc(op.id);
    var before=(op.c==='trips'||op.c==='services')?(op.prev||null):null;
    var p=op.data?ref.set(op.data):ref.delete();
    if(op.c==='trips'||op.c==='services') db.collection('history').add({at:new Date().toISOString(),by:me,c:op.c,id:op.id,act:op.data?(before?'수정':'추가'):'삭제',before:before?JSON.stringify(before):''}).catch(function(){});
    return p.catch(function(e){ throw (e&&e.code==='unavailable')?{retry:true}:{msg:'저장하지 못했어요. 보기 전용 권한일 수 있어요.'}; });
  }};
  setInterval(flush,30000); window.addEventListener('online',flush);
  setSync(); render();
}
var downloadsCap=null, inClaude=!!(window.claude&&window.claude.use);
function boot(){
  if(typeof google!=='undefined'&&google.script&&google.script.run){useSheet();return;}
  if(inClaude){
    window.claude.use('downloads').then(function(d){downloadsCap=d;});
    window.claude.use('db').then(function(db){ if(db) useCloud(db); else useLocal(); });
    return;
  }
  if(window.CC&&!window.CC_DISABLED&&CC.isCenter()){useCenter();return;}
  useLocal();
}

/* ============ 3. 화면 ============ */
var ui={tab:'home',vid:LS.get('cj.ui',{}).vid||null,month:today().slice(0,7)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function $(id){return document.getElementById(id);}
function toast(msg){var t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove();},Math.min(9000,Math.max(3200,msg.length*110)));}
function vids(){return Object.keys(S.vehicles).sort(function(a,b){return (S.vehicles[a].ts||0)-(S.vehicles[b].ts||0);});}
function curVid(){var ids=vids(); if(!ids.length)return null; if(!S.vehicles[ui.vid])ui.vid=ids[0]; return ui.vid;}
function hasExamples(){return COLLS.some(function(c){return vals(S[c]).some(function(x){return x.ex;});});}
function exTag(x){return x&&x.ex?' <span class="ex">예시</span>':'';}
var PILL={ok:'정상',soon:'곧 챙기기',over:'지났어요',unk:'기록 필요'};
var alertsNow=[];

function render(){
  rowDirty=false;
  $('centerName').textContent=S.settings.center?S.settings.center+' · 차량 점검 알림과 운행일지':'지역아동센터 차량 점검 알림 · 운행일지';
  var vid=curVid(), now=today(); alertsNow=vid?allAlerts(S,vid,now):[];
  var urgent=alertsNow.filter(function(a){return a.st==='over'||a.st==='soon';}).length;
  var tabs=[['home','오늘'],['log','운행일지'],['care','점검·정비'],['set','설정']];
  $('tabs').innerHTML=tabs.map(function(t){return '<button role="tab" id="tab-'+t[0]+'" aria-selected="'+(ui.tab===t[0])+'" data-act="tab" data-v="'+t[0]+'">'+t[1]+(t[0]==='care'&&urgent?'<span class="cnt" aria-label="챙길 것 '+urgent+'건">'+urgent+'</span>':'')+'</button>';}).join('');
  var h='';
  if(store.mode==='loading'){ h='<div class="card empty"><p>기록을 불러오고 있어요…</p></div>'; }
  else if(!vid && ui.tab!=='set'){ h=viewWelcome(); }
  else h={home:viewHome,log:viewLog,care:viewCare,set:viewSet}[ui.tab](vid,now,alertsNow);
  $('view').innerHTML='<div class="wrap" style="gap:18px">'+h+'</div>'; syncTimes();
  setSync();
}
function viewWelcome(){
  return '<div class="card empty"><h2>처음 오셨네요. 차량부터 등록해 주세요.</h2><p>차 이름과 지금 계기판 숫자(km)만 적으면 시작할 수 있어요.</p>'+
    '<div class="row" style="justify-content:center"><button class="btn main big" data-act="veh-new">차량 등록하기</button><button class="btn" data-act="ex-add">예시로 먼저 살펴보기</button></div></div>';
}
function vehPicker(vid){
  var ids=vids(); if(ids.length<2) return '';
  return '<div class="chips" role="group" aria-label="차량 고르기">'+ids.map(function(id){var v=S.vehicles[id];return '<button class="chip" aria-pressed="'+(id===vid)+'" data-act="veh-pick" data-v="'+id+'">'+esc(v.name)+'</button>';}).join('')+'</div>';
}
function exBanner(){
  return hasExamples()?'<div class="banner"><span class="grow"><b>지금 보이는 것은 예시 기록이에요.</b> 눌러 보며 익힌 뒤, 우리 센터 차량으로 시작하세요.</span><button class="btn sm" data-act="ex-clear">예시 지우고 시작하기</button></div>':'';
}
function ring(a){
  var r=16, c=2*Math.PI*r, p=Math.max(0.04,Math.min(1,a.ratio||0));
  var mark=a.st==='over'?'!':a.st==='unk'?'?':'';
  return '<svg class="ring '+a.st+'" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="'+r+'"/>'+(a.st==='unk'?'':'<circle class="fg" cx="20" cy="20" r="'+r+'" stroke-dasharray="'+(c*p).toFixed(1)+' '+c.toFixed(1)+'"/>')+(mark?'<text x="20" y="25.5">'+mark+'</text>':'')+'</svg>';
}
function shortLabel(a){ return a.st==='unk'?'기록 없음':a.label.split(' · ')[0]; }
function tile(a){
  return '<button class="tile '+a.st+'" data-act="al-open" data-v="'+esc(a.key)+'" aria-label="'+esc(a.full)+', '+PILL[a.st]+', '+esc(a.label)+'">'+ring(a)+'<span class="tx"><b>'+esc(a.name)+'</b><span>'+esc(shortLabel(a))+'</span></span></button>';
}
// 노란 차 캐릭터. mood에 따라 표정이 바뀐다.
function buddySvg(mood){
  var mouth=mood==='over'?'<ellipse cx="46" cy="33" rx="3.2" ry="3.8" fill="#16233a"/>':mood==='soon'?'<path d="M41 34h10" stroke="#16233a" stroke-width="2.4" stroke-linecap="round"/>':'<path d="M40 31q6 6 12 0" stroke="#16233a" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
  var brow=mood==='over'?'<path d="M31 17l7 2M61 17l-7 2" stroke="#16233a" stroke-width="2" stroke-linecap="round"/><path d="M70 8q3 5 0 8q-3-3 0-8z" fill="#6cc3ff"/>':'';
  return '<svg viewBox="0 0 92 72" aria-hidden="true"><ellipse cx="46" cy="66" rx="34" ry="4" fill="#16233a" opacity=".12"/><rect x="8" y="12" width="76" height="42" rx="14" fill="#ffc400"/><rect x="8" y="40" width="76" height="6" fill="#16233a"/><rect x="16" y="6" width="60" height="12" rx="6" fill="#ffc400"/>'+
    '<circle cx="34" cy="25" r="5.4" fill="#fff"/><circle cx="58" cy="25" r="5.4" fill="#fff"/><circle cx="35" cy="26" r="2.6" fill="#16233a"/><circle cx="59" cy="26" r="2.6" fill="#16233a"/>'+brow+mouth+
    '<circle cx="24" cy="33" r="3" fill="#ff8f6b" opacity=".7"/><circle cx="68" cy="33" r="3" fill="#ff8f6b" opacity=".7"/>'+
    '<rect x="4" y="34" width="8" height="5" rx="2" fill="#fff3c4"/><rect x="80" y="34" width="8" height="5" rx="2" fill="#fff3c4"/>'+
    '<circle cx="26" cy="56" r="9" fill="#16233a"/><circle cx="26" cy="56" r="3.5" fill="#cfd6e0"/><circle cx="66" cy="56" r="9" fill="#16233a"/><circle cx="66" cy="56" r="3.5" fill="#cfd6e0"/></svg>';
}
function buddy(mood,head,sub){ return '<div class="buddy">'+buddySvg(mood)+'<div class="bubble '+mood+'" role="status"><b>'+esc(head)+'</b><span>'+esc(sub)+'</span></div></div>'; }
// 오늘 화면의 「점검 한눈에」: 노랑이의 한마디 + 항목 타일 + 철 관리
function board(al){
  var cnt={over:0,soon:0,unk:0,ok:0}; al.forEach(function(a){cnt[a.st]++;});
  var say=mascotSay(al), sea=seasonOf(today());
  return '<div class="card board">'+buddy(say.mood,say.head,say.sub)+
    '<div class="tiles">'+al.map(tile).join('')+'</div>'+
    '<div class="legend"><span><i style="background:var(--over)"></i>지났어요</span><span><i style="background:var(--soon)"></i>곧 챙기기</span><span><i style="background:var(--ok)"></i>정상</span><span><i style="background:var(--unk)"></i>기록 필요</span><span>동그라미는 주기를 얼마나 썼는지 보여 줘요. 누르면 계산 근거가 나와요.</span></div>'+
    (cnt.unk>=2?'<div class="sub"><span class="grow">기록이 없는 항목 <b>'+cnt.unk+'개</b>. 정비 명세서를 보고 한 번에 적어 두면 편해요.</span><button class="btn sm navy" data-act="bulk">한 번에 적기</button></div>':'')+
    '<div class="season"><span class="pill unk">'+sea.name+' 관리</span><span class="grow">'+esc(sea.line)+'</span><button class="btn sm" data-act="season">'+sea.name+'에 챙길 것 보기</button></div></div>';
}
function viewHome(vid,now,al){
  var v=S.vehicles[vid], odo=odoOf(S,vid);
  var digits=String(odo).padStart(6,'0').split('').map(function(d){return '<span>'+d+'</span>';}).join('');
  var recent=Object.entries(S.trips).filter(function(e){return e[1].vid===vid;}).sort(function(a,b){return (b[1].date+String(b[1].startKm).padStart(8,'0')).localeCompare(a[1].date+String(a[1].startKm).padStart(8,'0'));}).slice(0,3);
  var qk=quickTemplates(vid);
  return exBanner()+draftBanner()+backupBanner()+vehPicker(vid)+
  '<div class="card hero"><div class="grow" style="display:flex;flex-direction:column;gap:10px"><div class="row"><h2>'+esc(v.name)+exTag(v)+'</h2><span class="muted">'+esc(v.plate||'')+'</span></div>'+
    '<div class="odo" aria-label="현재 주행거리 '+fmtKm(odo)+'킬로미터">'+digits+'<em>km</em></div></div>'+
    '<button class="btn main big" data-act="trip-new">오늘 운행 기록하기</button></div>'+
  (qk.length?'<div class="card list"><h3>자주 하는 운행 바로 적기</h3><p class="muted small">지난번과 같은 내용을 미리 채워 드려요. <b>도착 km</b>와 확인 칸만 보고 저장하면 돼요.</p><div class="quick">'+
    qk.map(function(q,i){return '<button class="btn" data-act="trip-like" data-v="'+i+'"><span>'+esc(q.purpose)+(q.dest?' · '+esc(q.dest):'')+'</span><small>'+esc((q.startTime||'')+(q.endTime?'~'+q.endTime:''))+(q.driver?' · '+esc(q.driver):'')+'</small></button>';}).join('')+'</div></div>':'')+
  '<div class="row"><h2 class="grow">최근 운행</h2><button class="btn sm" data-act="tab" data-v="log">운행일지 전체 보기</button></div>'+
  (recent.length?'<div class="list">'+recent.map(function(e){var t=e[1];return '<div class="item card"><b>'+fmtD(t.date)+'</b><span class="pill unk">'+esc(t.purpose)+'</span><span class="grow">'+esc(t.driver)+' 선생님'+(t.dest?' · '+esc(t.dest):'')+exTag(t)+'</span><b class="num">'+fmtKm(t.endKm-t.startKm)+'km</b></div>';}).join('')+'</div>':'<p class="muted">아직 운행 기록이 없어요. 위의 노란 버튼으로 첫 기록을 남겨 보세요.</p>')+
  careFold(al);
}
// 오늘 화면의 차량 점검은 폴더 하나로 접어 둔다. 누르면 펼쳐져 타일이 보인다. (펼친 상태는 기기에 기억)
function careFold(al){
  var cnt={over:0,soon:0,unk:0,ok:0}; al.forEach(function(a){cnt[a.st]++;});
  var st=cnt.over?'over':cnt.soon?'soon':cnt.ok?'ok':'unk', mark={over:'!',soon:'!',ok:'✓',unk:'?'}[st];
  var line=cnt.over||cnt.soon?[cnt.over?'지난 것 '+cnt.over+'개':'',cnt.soon?'곧 챙길 것 '+cnt.soon+'개':''].filter(Boolean).join(' · '):cnt.ok?'지금은 모두 괜찮아요':'교환한 날을 적어 주시면 챙겨 드려요';
  return '<details class="card fold" id="careFold"'+(LS.get('cj.fold',false)?' open':'')+'><summary><span class="light '+st+'" aria-hidden="true">'+mark+'</span><span class="grow"><b style="font-size:1.15rem">차량 점검 · 정비 알림</b><br><span class="'+(cnt.over?'pill over':cnt.soon?'pill soon':'muted')+'">'+line+'</span></span><span class="open"><span class="c">눌러서 열기 ▼</span><span class="o">접기 ▲</span></span></summary>'+board(al)+'</details>';
}
// 같은 목적(+목적지)으로 다녀온 최근 운행을 3가지까지 골라 '바로 적기' 단추로 보여 준다
function quickTemplates(vid){
  var list=Object.keys(S.trips).map(function(id){return S.trips[id];}).filter(function(t){return t.vid===vid;})
    .sort(function(a,b){return (b.date+(b.endTime||'')).localeCompare(a.date+(a.endTime||''));}).slice(0,40);
  var seen={}, out=[];
  list.forEach(function(t){ var k=t.purpose+'|'+(t.dest||''); if(seen[k]) { seen[k].n++; return; } seen[k]={t:t,n:1}; out.push(seen[k]); });
  return out.sort(function(a,b){return b.n-a.n;}).slice(0,3).map(function(x){return x.t;});
}
// 저장하지 않고 닫은 운행 기록이 있으면 알려 준다
function draftBanner(){ var d=LS.get('cj.draft',null); return d&&d.vid===curVid()?'<div class="banner"><span class="grow"><b>저장하지 않은 운행 기록이 있어요.</b> 쓰던 내용을 보관해 두었어요.</span><button class="btn sm main" data-act="trip-new">이어서 쓰고 저장하기</button><button class="btn sm" data-act="draft-drop">버리기</button></div>':''; }
// 이 기기에만 저장하는 판에서는 기록이 쌓일 때마다 백업을 권한다
function backupBanner(){
  if(store.mode!=='local'||hasExamples()) return ''; var n=Object.keys(S.trips).length+Object.keys(S.services).length, last=LS.get('cj.bk',0);
  return n-last>=10?'<div class="banner"><span class="grow"><b>기록이 날아가지 않게 백업해 두세요.</b> 마지막 백업 뒤로 기록 '+(n-last)+'건이 쌓였어요. 지금은 이 기기에만 저장돼 있어요.</span><button class="btn sm main" data-act="backup">백업 파일 저장</button></div>':'';
}
function tripsOf(vid,month){
  return Object.entries(S.trips).filter(function(e){return e[1].vid===vid&&e[1].date.slice(0,7)===month;}).sort(function(a,b){return (a[1].date+String(a[1].startKm).padStart(8,'0')).localeCompare(b[1].date+String(b[1].startKm).padStart(8,'0'));});
}
function viewLog(vid){
  var list=tripsOf(vid,ui.month), total=0, kids=0, g=gaps(S,vid), locked=isLocked(S,ui.month); list.forEach(function(e){total+=e[1].endKm-e[1].startKm; kids+=(+e[1].riders||0);});
  var rows=list.map(function(e){var t=e[1], gap=g[e[0]];return '<tr><td>'+fmtD(t.date)+exTag(t)+'</td><td>'+esc(t.startTime||'-')+'</td><td>'+esc(t.endTime||'-')+'</td><td>'+esc(t.purpose)+(t.dest?' ('+esc(t.dest)+')':'')+'</td><td class="r"><b>'+fmtKm(t.endKm-t.startKm)+'km</b><br><span class="muted small">'+fmtKm(t.startKm)+' → '+fmtKm(t.endKm)+'</span>'+(gap?'<br><span class="warn">앞 기록과 '+fmtKm(Math.abs(gap))+'km '+(gap>0?'비어요':'겹쳐요')+'</span>':'')+'</td><td>'+esc(t.driver)+(t.drvOk?' <span class="pill ok">확인</span>':' <span class="pill unk">확인 전</span>')+'</td><td>'+(t.guardian?esc(t.guardian)+(t.guardOk?' <span class="pill ok">확인</span>':' <span class="pill unk">확인 전</span>'):'-')+'</td><td class="chk">'+esc(checkText(t))+'</td><td class="r">'+(t.riders||0)+'</td><td>'+(locked?'':'<button class="linkbtn" data-act="trip-edit" data-v="'+e[0]+'">고치기</button>')+'</td></tr>';}).join('');
  var saveLabel=inClaude?'인쇄용 파일 저장':'인쇄하기', rowOn=!locked&&rowMode();
  return vehPicker(vid)+
  '<div class="row"><h2 class="grow">운행일지</h2>'+(locked?'':'<button class="btn" data-act="row-mode" aria-pressed="'+rowOn+'">'+(rowOn?'표에 바로 적기 끄기':'표에 바로 적기')+'</button><button class="btn main" data-act="trip-new">+ 운행 기록하기</button>')+'</div>'+
  (rowOn?'<div class="banner entryhelp" style="background:var(--surface2)"><span class="grow"><b>종이 일지처럼 표 바로 아래 노란 칸에 한 줄씩 적으세요.</b> 칸 사이는 <span class="key">Tab</span>, 저장은 <span class="key">Enter</span>. 종이에 먼저 적어 두었다가 한꺼번에 옮겨 적어도 돼요.</span></div>':'')+
  '<div class="row"><button class="btn sm" data-act="month" data-v="-1" aria-label="이전 달">◀ 이전 달</button><b class="num" style="font-size:1.2rem">'+ui.month.replace('-','년 ')+'월</b><button class="btn sm" data-act="month" data-v="1" aria-label="다음 달">다음 달 ▶</button><span class="grow"></span><button class="btn sm" data-act="print">'+saveLabel+'</button><button class="btn sm" data-act="claim" title="이 달 운행일지 + 유류수불대장 + 지출 내역 + 영수증 양식">청구용 인쇄 (일지+영수증)</button><details class="menu" id="fileMenu"><summary class="btn sm">다른 인쇄·파일 ▾</summary><div class="menu-list"><button class="btn sm" data-act="fuel">유류수불대장 인쇄</button><button class="btn sm" data-act="csv">엑셀 파일 저장</button>'+(inClaude?'':'<button class="btn sm" data-act="hwpx">한글 파일 저장</button>')+'</div></details>'+
    (locked?'<button class="btn sm" data-act="unlock">마감 풀기</button>':(list.length?'<button class="btn sm" data-act="lock">이 달 마감하기</button>':''))+'</div>'+
  (locked?'<div class="banner" style="background:var(--ok-bg)"><b>마감한 달이에요.</b><span class="grow">결재가 끝난 기록이라 고치거나 지울 수 없어요. 고쳐야 하면 [마감 풀기]를 눌러 주세요.</span></div>':'')+
  (list.length?'<div class="tablebox"><table class="logt"><thead><tr><th>일자</th><th>출발 시간</th><th>도착 시간</th><th>운행 목적</th><th class="r">운행 거리</th><th>운전자 확인</th><th>동승자 확인</th><th>차량 점검 내용</th><th class="r">탑승 아동</th><th></th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td colspan="4">'+list.length+'회 운행</td><td class="r">'+fmtKm(total)+'km</td><td colspan="3"></td><td class="r">'+kids+'</td><td></td></tr></tfoot></table></div>'
   :'<div class="card empty"><p>이 달에는 운행 기록이 없어요.</p></div>')+
  (rowOn?entryRow(vid):'');
}
// '표에 바로 적기'는 PC(넓은 화면)에서 처음부터 켜 둔다. 끄고 켠 것은 기기가 기억한다.
function rowMode(){ var m=LS.get('cj.rowmode',null); return m==null?innerWidth>700:!!m; }
// 무언가 적는 중이면 자동 새로 고침으로 화면을 다시 그리지 않는다
var rowDirty=false;
function canRedraw(){ return !document.getElementById('dlg').open && !rowDirty; }
function alertRow(a){
  var act='';
  if(a.kind==='item') act='<button class="btn sm '+(a.st==='ok'?'':'navy')+'" data-act="svc-new" data-v="'+a.key+'">'+(a.st==='unk'?'교환한 날 적기':'교환했어요')+'</button>';
  else if(a.kind==='edu') act='<button class="btn sm" data-act="drv-edit" data-v="'+esc(a.key.slice(4))+'">교육일 고치기</button>';
  else act='<button class="btn sm" data-act="veh-edit">날짜 고치기</button>';
  var bar=(a.st!=='unk')?'<div class="bar '+(a.st==='ok'?'':a.st)+'"><i style="width:'+Math.min(100,Math.round((a.ratio||0)*100))+'%"></i></div>':'';
  return '<div class="alert '+a.st+'"><div class="mark"></div><div class="grow"><div class="row" style="gap:8px"><h3>'+esc(a.full)+'</h3><span class="pill '+a.st+'">'+PILL[a.st]+'</span><b class="num">'+esc(a.label)+'</b></div><p class="why">'+esc(a.why)+'</p>'+bar+'</div><div class="act">'+act+'</div></div>';
}
function viewCare(vid,now,al){
  var hist=Object.entries(S.services).filter(function(e){return e[1].vid===vid;}).sort(function(a,b){return b[1].date.localeCompare(a[1].date);});
  var v=S.vehicles[vid];
  return vehPicker(vid)+
  '<div class="card list"><div class="row"><h3 class="grow">주유·정비 영수증</h3></div><p class="muted small">구청에 청구할 때 쓰는 <b>지출 증빙서(영수증 붙이는 종이)</b>를 인쇄해요. 왼쪽에 영수증 원본, 오른쪽에 사본을 붙여 나란히 비교할 수 있어요.</p>'+
    '<div class="row"><button class="btn main" data-act="exp-new">+ 주유·구입 기록하기</button><button class="btn" data-act="rc-blank">빈 영수증 양식 인쇄</button><button class="btn" data-act="fuel">이 달 유류수불대장 인쇄</button></div></div>'+
  '<div class="row"><h2 class="grow">점검·정비</h2>'+(inClaude?'':'<button class="btn sm" data-act="ics">달력에 알림 넣기</button>')+'</div>'+
  '<p class="muted small">'+(v.ivChecked?'주기는 차량 설명서로 확인한 값이에요.':'주기는 일반 권장값이에요. 차량 설명서와 다르면 설정에서 고치고 \'설명서로 확인했어요\'에 표시해 주세요.')+'</p>'+
  '<div class="alerts">'+al.map(alertRow).join('')+'</div>'+
  '<div class="row"><h2 class="grow">정비·지출 이력</h2>'+(hist.length?'<button class="btn sm" data-act="svc-csv">엑셀 파일 저장</button>':'')+'</div>'+
  (hist.length?'<div class="tablebox"><table><thead><tr><th>날짜</th><th>항목</th><th class="r">그때 km</th><th class="r">비용</th><th>정비소·메모</th><th>영수증</th><th></th></tr></thead><tbody>'+hist.map(function(e){var s=e[1];return '<tr><td>'+fmtD(s.date)+exTag(s)+'</td><td>'+esc(svcName(s))+'</td><td class="r">'+(s.km?fmtKm(s.km):'-')+'</td><td class="r">'+(s.cost?fmtKm(s.cost)+'원':'-')+'</td><td>'+esc([s.shop,s.memo].filter(Boolean).join(' · '))+'</td><td><button class="linkbtn" data-act="rc-one" data-v="'+e[0]+'">양식 인쇄</button></td><td><button class="linkbtn" data-act="svc-del" data-v="'+e[0]+'">지우기</button></td></tr>';}).join('')+'</tbody></table></div>':'<p class="muted">아직 정비 기록이 없어요.</p>');
}
// 정비 항목이 아닌 지출 (주유, 세차 등). 정비 기록과 같은 곳(정비기록 시트)에 저장하고 점검 주기 계산에는 쓰지 않는다.
var EXPS=[{k:'fuel',n:'주유'},{k:'wash',n:'세차'},{k:'part',n:'부품·용품 구입'},{k:'repair',n:'수리'},{k:'etcx',n:'기타 지출'}];
function svcName(s){ if(s.itemName) return s.itemName; var a=ITEMS.concat(EXPS).filter(function(i){return i.k===s.item;})[0]; return a?(a.full||a.n):s.item; }
function viewSet(vid){
  var st=S.settings, drv=driversOf(S);
  var modeText={cloud:'이 주소를 PC와 휴대폰에서 열면 같은 기록이 보여요. 한쪽에서 적으면 다른 쪽에 바로 나타납니다.',sheet:'기록은 센터 구글 시트에 저장돼요. 로그인 없이 센터 암호로 들어오고, 다른 기기에는 20초 안에 나타납니다.',local:'지금은 이 기기(브라우저)에만 저장돼요. PC와 휴대폰에서 함께 쓰려면 구글 시트판 주소로 열어 주세요.'}[store.mode]||'';
  return '<h2>설정</h2><div class="banner" style="background:var(--surface2)"><span>'+modeText+'</span></div><div class="setgrid">'+
  '<div class="card list"><h3>센터</h3><div class="field"><label for="setCenter">센터 이름</label><input class="in" id="setCenter" value="'+esc(st.center)+'" placeholder="예: ○○지역아동센터"></div>'+
    '<div class="field"><label for="setAppr">결재란 (빗금 / 으로 나눠 적기)</label><input class="in" id="setAppr" value="'+esc(st.approvers||'')+'" placeholder="담당자/시설장"><span class="hint">운행일지를 인쇄할 때 오른쪽 위에 들어가요.</span></div>'+
    (store.mode==='sheet'?'<div class="field"><label for="setMail">알림 메일 받을 주소 (쉼표로 여러 개)</label><input class="in" id="setMail" value="'+esc(st.emails||'')+'" placeholder="예: center@example.com"><span class="hint">매주 월요일 아침, 챙길 것이 있을 때만 보내요.</span></div>':'')+
    '<button class="btn navy" data-act="set-save">저장</button></div>'+
  '<div class="card list"><h3>차량</h3>'+(vids().map(function(id){var v=S.vehicles[id];return '<div class="item"><b class="grow">'+esc(v.name)+exTag(v)+'</b><span class="muted">'+esc(v.plate||'')+'</span><button class="btn sm" data-act="veh-edit" data-v="'+id+'">고치기</button></div>';}).join('')||'<p class="muted">등록한 차량이 없어요.</p>')+'<button class="btn main" data-act="veh-new">+ 차량 추가</button>'+
    (vid?'<button class="btn" data-act="iv-edit">'+esc(S.vehicles[vid].name)+' 점검 주기 고치기</button>':'')+'</div>'+
  '<div class="card list"><h3>운전하는 선생님</h3><p class="hint muted small">통학버스 안전교육을 마지막으로 받은 날을 적어 두면 다음 교육 때를 미리 알려 드려요.</p>'+(drv.map(function(d){return '<div class="item"><b class="grow">'+esc(d.name)+exTag(S.drivers[d.id])+'</b><span class="muted small">교육 '+(d.edu?fmtD(d.edu):'날짜 없음')+'</span><button class="btn sm" data-act="drv-edit" data-v="'+d.id+'">고치기</button></div>';}).join('')||'<p class="muted">아직 없어요.</p>')+'<button class="btn" data-act="drv-new">+ 선생님 추가</button></div>'+
  '<div class="card list"><h3>이 기기</h3><div class="field"><label for="setMe">이 기기를 쓰는 사람</label><input class="in" id="setMe" value="'+esc(me)+'" placeholder="내 이름"><span class="hint">기록마다 누가 적었는지 남겨요.</span></div><button class="btn" data-act="me-save">저장</button>'+
    (store.mode==='sheet'?'<button class="btn" data-act="pin-change">센터 암호 바꾸기</button>':'')+'</div>'+
  '<div class="card list"><h3>백업</h3><p class="muted small">모든 기록을 파일 하나로 내려받아 보관하거나, 보관한 파일에서 다시 불러와요. 다른 판으로 옮길 때도 써요.</p><button class="btn" data-act="backup">전체 백업 파일 저장</button><button class="btn" data-act="restore">백업 파일에서 불러오기</button></div>'+
  '<div class="card list"><h3>저장하는 정보</h3><p class="muted small">저장하는 것은 차량 이름·번호, 운전자 이름과 교육일, 운행·정비 기록입니다. <b>아동 이름은 받지 않으니 메모에도 적지 말아 주세요.</b> 그만둔 선생님은 위 목록에서 [고치기] → [지우기]로 지울 수 있어요. 보관 기간은 센터의 문서 보존 기준을 따르세요.</p></div>'+
  (hasExamples()?'<div class="card list"><h3>예시 기록</h3><button class="btn danger" data-act="ex-clear">예시 지우고 시작하기</button></div>':'')+
  '</div>';
}

/* ============ 4. 입력 창 ============ */
function openDlg(html){var d=$('dlg'); d.innerHTML='<form class="dlg" method="dialog" id="dlgForm">'+html+'</form>'; if(!d.open) d.showModal();}
function closeDlg(){var d=$('dlg'); if(d.open)d.close(); d.innerHTML=''; render();}
function chipsField(id,label,opts,val,allowOther){
  return '<div class="field"><span class="lab" id="'+id+'Lab">'+label+'</span><div class="chips" role="group" aria-labelledby="'+id+'Lab">'+opts.map(function(o){return '<button type="button" class="chip" aria-pressed="'+(o===val)+'" data-act="chip" data-f="'+id+'" data-v="'+esc(o)+'">'+esc(o)+'</button>';}).join('')+'</div>'+
    (allowOther?'<input class="in" id="'+id+'" value="'+esc(val||'')+'" placeholder="직접 적기" aria-labelledby="'+id+'Lab">':'<input type="hidden" id="'+id+'" value="'+esc(val||'')+'">')+'</div>';
}
function alertDlg(key){
  var a=alertsNow.filter(function(x){return x.key===key;})[0]; if(!a) return;
  var act;
  if(a.kind==='item') act='<button type="button" class="btn main" data-act="svc-new" data-v="'+a.key+'">'+(a.st==='unk'?'교환한 날 적기':'교환했어요')+'</button>';
  else if(a.kind==='edu') act='<button type="button" class="btn main" data-act="drv-edit" data-v="'+esc(a.key.slice(4))+'">교육일 고치기</button>';
  else act='<button type="button" class="btn main" data-act="veh-edit">날짜 고치기</button>';
  var iv=a.iv?[a.iv.km?fmtKm(a.iv.km)+'km':'',a.iv.mo?a.iv.mo+'개월':''].filter(Boolean).join(' 또는 '):'';
  openDlg('<header><h2>'+esc(a.full)+'</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
    '<div class="row"><span class="pill '+a.st+'">'+PILL[a.st]+'</span><b class="num" style="font-size:1.3rem">'+esc(a.label)+'</b></div>'+
    (a.st!=='unk'?'<div class="bar '+(a.st==='ok'?'':a.st)+'" style="height:14px"><i style="width:'+Math.min(100,Math.round((a.ratio||0)*100))+'%"></i></div>':'')+
    '<p class="muted">'+esc(a.tip||'')+'</p>'+
    '<div class="dist" style="font-weight:500;font-size:1rem"><b>계산 근거</b><br>'+esc(a.why).replace(/ \/ /g,'<br>')+(iv?'<br><span class="muted small">주기 '+iv+' (먼저 오는 쪽) · '+esc(a.src)+'</span>':'')+'</div>'+
    (a.estD&&a.st!=='over'?'<p>지금처럼 타면 <b>'+fmtMD(a.estD)+'쯤</b> 주기에 닿아요. <span class="muted small">(최근 30일 평균으로 어림한 날짜)</span></p>':'')+
    '</div><footer><button type="button" class="btn" data-act="dlg-close">닫기</button>'+act+'</footer>');
}
function bulkForm(){
  var vid=curVid(), unk=alertsNow.filter(function(a){return a.kind==='item'&&a.st==='unk';});
  openDlg('<header><h2>교환한 날 한 번에 적기</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body"><p class="muted">정비 명세서나 앞 유리 스티커를 보고 <b>아는 것만</b> 적으세요. 모르는 줄은 비워 두면 돼요.</p>'+
    unk.map(function(a){return '<div class="bulk"><b>'+esc(a.full)+'</b><input class="in" type="date" id="bd_'+a.key+'" max="'+today()+'" aria-label="'+esc(a.full)+' 교환한 날"><input class="in num" id="bk_'+a.key+'" inputmode="numeric" placeholder="그때 km" aria-label="'+esc(a.full)+' 그때 km"></div>';}).join('')+
    '<div id="bErr" role="alert"></div></div><footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="bulk-save">적은 것만 저장하기</button></footer>');
}
function saveBulk(){
  var vid=curVid(), n=0, bad='';
  alertsNow.filter(function(a){return a.kind==='item'&&a.st==='unk';}).forEach(function(a,i){
    var d=$('bd_'+a.key).value, km=numVal('bk_'+a.key); if(!d) return;
    if(d>today()){bad=a.full;return;}
    put('services',newId(),{vid:vid,item:a.key,itemName:a.full,date:d,km:isNaN(km)?0:km,cost:0,shop:'',by:me,ts:Date.now()+i}); n++;
  });
  if(bad){$('bErr').innerHTML='<div class="err">'+esc(bad)+': 오늘보다 뒤의 날짜예요.</div>';return;}
  closeDlg(); toast(n?n+'개 항목을 저장했어요. 다음 시기를 계산했습니다.':'적은 항목이 없어요.');
}
function nowHM(){var d=new Date(); d.setMinutes(Math.round(d.getMinutes()/5)*5,0,0); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
// 시간 고르기: [오전][오후] 단추 → 시(1~12) → 분(5분 단위). 실제 값(13:30)은 숨은 칸에 들어간다.
// 다음에 골라야 할 칸에는 깜박이는 커서와 노란 테두리를 보여 주고, 아래에 무엇을 고를지 한 줄로 알려 준다.
function hourName(h){ return h===0?'오전 0시':h<12?'오전 '+h+'시':h===12?'낮 12시':'오후 '+(h-12)+'시'; }
function to12(v){ if(!v) return {ap:'',h:'',m:''}; var p=v.split(':'), H=+p[0]; return {ap:H<12?'AM':'PM',h:String(H%12||12),m:p[1]}; }
function to24(ap,h,m){ var H=+h%12+(ap==='PM'?12:0); return String(H).padStart(2,'0')+':'+m; }
function timeSel(id,val,label){
  var t=to12(val), ms=[], hs='';
  for(var m=0;m<60;m+=5) ms.push(String(m).padStart(2,'0'));
  if(t.m&&ms.indexOf(t.m)<0){ ms.push(t.m); ms.sort(); }   // 예전에 1분 단위로 적은 기록도 그대로 보인다
  for(var h=1;h<=12;h++) hs+='<option value="'+h+'"'+(String(h)===t.h?' selected':'')+'>'+h+'시</option>';
  return '<div class="tsel" id="'+id+'_box"><input type="hidden" id="'+id+'" value="'+esc(val||'')+'"><input type="hidden" id="'+id+'_ap" value="'+t.ap+'">'+
    '<div class="ampm" role="group" aria-label="'+label+' 오전·오후">'+['AM','PM'].map(function(a){return '<button type="button" data-act="ampm" data-tm="'+id+'" data-v="'+a+'" aria-pressed="'+(t.ap===a)+'">'+(a==='AM'?'오전':'오후')+'</button>';}).join('')+'</div>'+
    '<div class="hm"><span class="slot"><select class="in" id="'+id+'_h" data-tm="'+id+'" aria-label="'+label+' 시"><option value="">시</option>'+hs+'</select></span><b class="colon" aria-hidden="true">:</b>'+
    '<span class="slot"><select class="in" id="'+id+'_m" data-tm="'+id+'" aria-label="'+label+' 분"><option value="">분</option>'+ms.map(function(v){return '<option value="'+v+'"'+(v===t.m?' selected':'')+'>'+v+'분</option>';}).join('')+'</select></span></div>'+
    '<div class="thint" id="'+id+'_hint" aria-live="polite"></div></div>';
}
// 고른 것을 숨은 칸에 넣고, 다음에 고를 칸을 표시한다
function syncTime(id){
  var box=$(id+'_box'); if(!box) return;
  var ap=$(id+'_ap').value, h=$(id+'_h'), m=$(id+'_m');
  if(ap&&h.value&&!m.value) m.value='00';
  $(id).value=ap&&h.value&&m.value?to24(ap,h.value,m.value):'';
  box.querySelectorAll('[data-act=ampm]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.v===ap);});
  var next=!ap?box.querySelector('.ampm'):!h.value?h.parentNode:!m.value?m.parentNode:null;
  box.querySelectorAll('.next').forEach(function(x){x.classList.remove('next');}); if(next) next.classList.add('next');
  box.classList.toggle('done',!next);
  $(id+'_hint').innerHTML=!ap?'▶ 오전·오후를 먼저 골라 주세요':!h.value?'▶ 몇 시인지 골라 주세요':!m.value?'▶ 몇 분인지 골라 주세요':'<b>'+(ap==='AM'?'오전':'오후')+' '+h.value+':'+m.value+'</b> 으로 적어요';
}
function syncTimes(){ ['tST','tET','rST','rET'].forEach(syncTime); }
function timeNeed(id){ var ap=$(id+'_ap'); if(!ap) return ''; return !ap.value?'오전·오후를':!$(id+'_h').value?'시를':'분을'; }
var tripDirty=false, tripOpenedAt=0;
function tripForm(id,like){
  var vid=curVid(), t=id?S.trips[id]:null, odo=odoOf(S,vid), names=driversOf(S).map(function(d){return d.name;});
  var lastDriver=LS.get('cj.driver',''), draft=(id||like)?null:LS.get('cj.draft',null); if(draft&&draft.vid!==vid) draft=null;
  if(like) like={date:today(),startTime:like.startTime||'',endTime:like.endTime||nowHM(),driver:like.driver||'',purpose:like.purpose,dest:like.dest||'',startKm:odo,endKm:'',riders:+like.riders||0,guardian:like.guardian||'',drvOk:false,guardOk:false,checks:[],checkNote:'',memo:''};
  var d=t||like||draft||{date:today(),startTime:'',endTime:nowHM(),driver:lastDriver||me||names[0]||'',purpose:'등원',startKm:odo,endKm:'',riders:0,guardian:'',drvOk:false,guardOk:false,checks:[],checkNote:'',dest:'',memo:''};
  var have=checksOf(d); tripDirty=false;
  openDlg('<header><h2>'+(t?'운행 기록 고치기':'운행 기록하기')+'</h2><button type="button" class="btn sm" data-act="trip-close">닫기</button></header><div class="body" id="tripBody">'+
   (draft?'<div class="banner"><span class="grow">쓰다 만 내용을 불러왔어요. 확인하고 <b>저장하기</b>를 눌러 주세요.</span><button type="button" class="btn sm" data-act="draft-reset">지우고 새로 쓰기</button></div>':'')+
   (like?'<div class="banner"><span class="grow">지난번 <b>'+esc(like.purpose)+'</b> 운행 내용을 채워 두었어요. <b>도착 km</b>와 확인 칸만 보고 저장해 주세요.</span></div>':'')+
   '<div class="two"><div class="field"><label for="tDate">일자<span class="need">꼭</span></label><input class="in" type="date" id="tDate" value="'+d.date+'" max="'+today()+'"></div>'+
   '<div class="field"><span class="lab">차량</span><div class="in" style="display:flex;align-items:center;background:var(--surface2)">'+esc(S.vehicles[vid].name)+'</div></div></div>'+
   '<div class="two"><div class="field"><span class="lab">출발 시간<span class="need">꼭</span> <span class="muted small">(5분 단위)</span></span>'+timeSel('tST',d.startTime,'출발 시간')+'</div>'+
   '<div class="field"><span class="lab">도착 시간<span class="need">꼭</span> <span class="muted small">(5분 단위)</span></span>'+timeSel('tET',d.endTime,'도착 시간')+'</div></div>'+
   chipsField('tPurpose','운행 목적',PURPOSES,d.purpose,false)+
   '<div class="field"><label for="tDest">목적지 <span class="muted small">(적지 않아도 돼요)</span></label><input class="in" id="tDest" value="'+esc(d.dest||'')+'" placeholder="예: ○○초등학교, 과학관"></div>'+
   '<div class="two"><div class="field"><label for="tStart">출발할 때 계기판 km</label><input class="in km" id="tStart" inputmode="numeric" value="'+d.startKm+'"><span class="hint">지난 운행의 도착 km를 넣어 두었어요.</span></div>'+
   '<div class="field"><label for="tEnd">도착했을 때 계기판 km<span class="need">꼭</span></label><input class="in km" id="tEnd" inputmode="numeric" value="'+d.endKm+'" placeholder="숫자만"></div></div>'+
   '<div class="dist" id="tDist" role="status">도착 km를 적으면 운행 거리를 계산해 드려요.</div>'+
   chipsField('tDriver','운전자<span class="need">꼭</span>',names,d.driver,true)+
   '<label class="check"><input type="checkbox" id="tDrvOk" '+(d.drvOk?'checked':'')+'><span><b>운전자 확인</b><br><span class="muted small">위 운행 내용이 맞는지 운전한 선생님이 확인했어요</span></span></label>'+
   '<div class="two"><div class="field"><label for="tGuard">동승자 (동승보호자)</label><input class="in" id="tGuard" value="'+esc(d.guardian||'')+'" placeholder="함께 탄 선생님 이름" list="tGuardList"><datalist id="tGuardList">'+names.map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist></div>'+
   '<div class="field"><span class="lab" id="tRidLab">탑승 아동 수</span><div class="stepper"><button type="button" data-act="step" data-v="-1" aria-label="한 명 줄이기">−</button><input class="in num" id="tRiders" inputmode="numeric" value="'+(d.riders||0)+'" aria-labelledby="tRidLab"><button type="button" data-act="step" data-v="1" aria-label="한 명 늘리기">+</button><span>명</span></div></div></div>'+
   '<label class="check"><input type="checkbox" id="tGuardOk" '+(d.guardOk?'checked':'')+'><span><b>동승자 확인</b><br><span class="muted small">함께 탄 선생님이 아이들 승하차와 운행 내용을 확인했어요</span></span></label>'+
   '<div class="field"><div class="row"><span class="lab grow" id="tChkLab">차량 점검 내용</span><button type="button" class="btn sm" data-act="chk-all">모두 이상 없음</button></div><div class="checks" role="group" aria-labelledby="tChkLab">'+CHECKS.map(function(c){return '<label><input type="checkbox" id="tc_'+c.k+'" '+(have.indexOf(c.k)>=0?'checked':'')+'>'+esc(c.n)+'</label>';}).join('')+'</div>'+
   '<input class="in" id="tChkNote" value="'+esc(d.checkNote||'')+'" placeholder="이상이 있으면 적어 주세요. 예: 오른쪽 뒤 타이어 바람 적음" aria-label="점검에서 이상이 있던 내용"></div>'+
   '<div class="field"><label for="tMemo">메모 <span class="muted small">(적지 않아도 돼요)</span></label><input class="in" id="tMemo" value="'+esc(d.memo||'')+'" placeholder="예: 주유 5만 원"></div>'+
   '<div id="tErr" role="alert"></div></div>'+
   '<footer>'+(t?'<button type="button" class="btn danger" data-act="trip-del" data-v="'+id+'">이 기록 지우기</button><span class="grow"></span>':'<span class="muted small grow">저장하기를 눌러야 기록이 남아요.</span>')+'<button type="button" class="btn" data-act="trip-close">취소</button><button type="button" class="btn main" data-act="trip-save" data-v="'+(id||'')+'">저장하기</button></footer>');
  $('dlg').dataset.trip=id?'edit':'new'; tripOpenedAt=Date.now();
  updDist(); syncTimes(); if(like){ try{$('tEnd').focus();}catch(e){} }
}
function readTrip(){
  var a=numVal('tStart'), b=numVal('tEnd');
  return {vid:curVid(),date:$('tDate').value,startTime:$('tST').value,endTime:$('tET').value,driver:$('tDriver').value.trim(),purpose:$('tPurpose').value||'기타',dest:$('tDest').value.trim(),startKm:isNaN(a)?'':a,endKm:isNaN(b)?'':b,riders:numVal('tRiders')||0,guardian:$('tGuard').value.trim(),drvOk:$('tDrvOk').checked,guardOk:$('tGuardOk').checked,checks:CHECKS.filter(function(c){return $('tc_'+c.k).checked;}).map(function(c){return c.k;}),checkNote:$('tChkNote').value.trim(),memo:$('tMemo').value.trim()};
}
// 쓰는 동안 내용을 이 기기에 보관한다 (창을 닫거나 화면이 꺼져도 날아가지 않게)
function keepDraft(){ if($('dlg').dataset.trip==='new'&&$('tDate')){ tripDirty=true; LS.set('cj.draft',readTrip()); } else if($('dlg').dataset.trip==='edit') tripDirty=true; }
function closeTrip(){
  var isNew=$('dlg').dataset.trip==='new', dirty=tripDirty; delete $('dlg').dataset.trip; tripDirty=false;
  if(isNew&&!dirty) LS.set('cj.draft',null);
  closeDlg(); if(dirty) toast(isNew?'아직 저장하지 않았어요. 쓰던 내용은 보관해 두었어요.':'고친 내용을 저장하지 않고 닫았어요.');
}
function numVal(id){var v=String($(id).value).replace(/[^0-9]/g,''); return v===''?NaN:+v;}
function updDist(){
  var el=$('tDist'); if(!el)return; var a=numVal('tStart'), b=numVal('tEnd');
  if(isNaN(b)||isNaN(a)){el.textContent='도착 km를 적으면 운행 거리를 계산해 드려요.';return;}
  if(b<a){el.innerHTML='<span style="color:var(--over)">도착 km가 출발 km보다 작아요. 계기판 숫자를 다시 봐 주세요.</span>';return;}
  el.textContent='운행 거리: '+fmtKm(b)+' − '+fmtKm(a)+' = '+fmtKm(b-a)+'km'+(b-a>300?'  (300km가 넘어요. 숫자가 맞는지 한 번 더 봐 주세요)':'');
}
// 운행을 저장하거나 지운 뒤 차량 문서에 최신 km를 적어 둔다 (오래된 운행을 읽지 않아도 주행거리를 알 수 있게)
function syncOdo(vid,hadMax){
  var v=S.vehicles[vid]; if(!v) return;
  var tmp=Object.assign({},v,{odo:0}), keep=v; S.vehicles[vid]=tmp; var loaded=odoOf(S,vid); S.vehicles[vid]=keep;
  var next=hadMax?loaded:Math.max(+v.odo||0,loaded);
  if(next!==(+v.odo||0)) put('vehicles',vid,Object.assign({},v,{odo:next}));
}
// 운행 기록이 맞는지 본다. 틀린 곳이 있으면 쉬운 말로 알려 준다. (입력 창과 '표에 바로 적기'가 함께 쓴다)
function tripError(f,old,pre){
  var a=f.startKm, b=f.endKm, err='';
  if(!f.date) err='일자를 골라 주세요.';
  else if(f.date>today()) err='오늘보다 뒤의 날짜예요. 일자를 다시 봐 주세요.';
  else if(isLocked(S,f.date.slice(0,7))||(old&&isLocked(S,old.date.slice(0,7)))) err='마감한 달이에요. 운행일지에서 [마감 풀기]를 한 뒤에 고칠 수 있어요.';
  else if(!f.startTime) err='출발 시간의 '+(timeNeed((pre||'t')+'ST')||'시간을')+' 골라 주세요.';
  else if(!f.endTime) err='도착 시간의 '+(timeNeed((pre||'t')+'ET')||'시간을')+' 골라 주세요.';
  else if(f.endTime<f.startTime) err='도착 시간이 출발 시간보다 빨라요. 시간을 다시 봐 주세요.';
  else if(a===''||b==='') err='출발 km와 도착 km를 숫자로 적어 주세요.';
  else if(b<a) err='도착 km가 출발 km보다 작아요. 계기판 숫자를 다시 봐 주세요.';
  else if(!f.driver) err='운전자를 고르거나 적어 주세요.';
  return err;
}
// 저장하고, 저장했다는 말을 돌려준다
function commitTrip(id,f,openedAt){
  var old=id?S.trips[id]:null, a=f.startKm, b=f.endKm;
  var vid=old?old.vid:f.vid, hadMax=!!old&&(+old.endKm===odoOf(S,vid)), nid=id||newId();
  var t=Object.assign(f,{vid:vid,by:me,ts:old?old.ts:Date.now()});
  if(old) t.editedAt=new Date().toISOString(); else t.secs=Math.round((Date.now()-openedAt)/1000);
  applyOp({c:'trips',id:nid,data:t}); send({c:'trips',id:nid,data:t,prev:old});
  LS.set('cj.driver',f.driver); syncOdo(vid,hadMax);
  var gap=gaps(S,vid)[nid], todo=[], lap=overlapOf(nid,t); if(!t.drvOk)todo.push('운전자 확인'); if(t.guardian&&!t.guardOk)todo.push('동승자 확인'); if(t.checks.length<CHECKS.length)todo.push('차량 점검');
  return '저장했어요. 운행 거리 '+fmtKm(b-a)+'km'+(gap?' · 앞 기록과 km가 '+fmtKm(Math.abs(gap))+'km 안 이어져요':'')+(todo.length?' · 아직 안 한 것: '+todo.join(', '):'')+(lap?' · 같은 날 '+lap.startTime+'~'+lap.endTime+' '+lap.purpose+' 운행과 시간이 겹쳐요':'');
}
// 같은 차, 같은 날에 시간이 겹치는 다른 운행 (잘못 고른 오전·오후를 찾는 데 도움)
function overlapOf(id,t){
  return Object.keys(S.trips).filter(function(k){var o=S.trips[k]; return k!==id&&o.vid===t.vid&&o.date===t.date&&o.startTime&&o.endTime&&o.startTime<t.endTime&&t.startTime<o.endTime;}).map(function(k){return S.trips[k];})[0]||null;
}
function saveTrip(id){
  var f=readTrip(), err=tripError(f,id?S.trips[id]:null,'t');
  if(err){$('tErr').innerHTML='<div class="err">'+err+'</div>';$('tErr').scrollIntoView({block:'nearest'});return;}
  var msg=commitTrip(id,f,tripOpenedAt); if(!id) LS.set('cj.draft',null);
  delete $('dlg').dataset.trip; tripDirty=false; closeDlg(); toast(msg);
}
/* --- 표에 바로 적기: 종이 일지를 쓰듯 운행일지 표 맨 아래 줄에 한 줄씩 적는다 (PC용) --- */
var rowOpenedAt=0, rowKeep=null;
function entryRow(vid){
  var names=driversOf(S).map(function(d){return d.name;}), odo=odoOf(S,vid), k=rowKeep||{};
  var cur=today().slice(0,7), date=k.date&&k.date.slice(0,7)===ui.month?k.date:(ui.month===cur?today():ui.month+'-01');
  var opt=function(o,sel){return '<option'+(o===sel?' selected':'')+'>'+esc(o)+'</option>';};
  // 표 바로 아래 노란 칸. 칸마다 이름을 보이고, 넓은 화면에서는 한 줄, 좁으면 두세 줄로 접힌다(옆으로 밀지 않아도 다 보이게).
  var F=function(lab,html,cls){return '<div class="ef'+(cls?' '+cls:'')+'"><span class="eflab">'+lab+'</span>'+html+'</div>';};
  return '<div class="card entry" id="entryRow"><div class="ehead"><b>노란 칸에 한 줄 적기</b><span class="muted small">종이 일지 한 줄처럼 · 칸 사이 Tab · 저장 Enter</span></div><div class="egrid">'+
    F('일자 <span class="need">꼭</span>','<input class="in" type="date" id="rDate" value="'+date+'" max="'+today()+'" aria-label="일자">')+
    F('출발 시간 <span class="need">꼭</span>',timeSel('rST',k.startTime,'출발 시간'),'wide')+
    F('도착 시간 <span class="need">꼭</span>',timeSel('rET',k.endTime,'도착 시간'),'wide')+
    F('운행 목적','<select class="in" id="rPurpose" aria-label="운행 목적">'+PURPOSES.map(function(p){return opt(p,k.purpose||'등원');}).join('')+'</select><input class="in" id="rDest" value="'+esc(k.dest||'')+'" placeholder="목적지(선택)" aria-label="목적지">')+
    F('출발 km → 도착 km <span class="need">꼭</span>','<input class="in num" id="rStart" inputmode="numeric" value="'+odo+'" aria-label="출발 km"><input class="in num" id="rEnd" inputmode="numeric" placeholder="도착 km" aria-label="도착 km">')+
    F('운전자 <span class="need">꼭</span>','<input class="in" id="rDriver" value="'+esc(k.driver||LS.get('cj.driver','')||me||names[0]||'')+'" list="rNames" aria-label="운전자"><label class="ck"><input type="checkbox" id="rDrvOk">운전자 확인</label>')+
    F('동승자','<input class="in" id="rGuard" value="'+esc(k.guardian||'')+'" list="rNames" placeholder="함께 탄 선생님" aria-label="동승자"><label class="ck"><input type="checkbox" id="rGuardOk">동승자 확인</label><datalist id="rNames">'+names.map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist>')+
    F('차량 점검','<label class="ck"><input type="checkbox" id="rChk">이상 없음 ('+CHECKS.length+'항목)</label><input class="in" id="rNote" placeholder="이상 있으면 적기" aria-label="점검에서 이상이 있던 내용">')+
    F('탑승 아동','<input class="in num" id="rRiders" inputmode="numeric" value="'+(k.riders!=null?k.riders:'')+'" placeholder="0" aria-label="탑승 아동 수">','narrow')+
    '</div><div class="row"><div id="rowErr" class="grow" role="alert"></div><button type="button" class="btn main" data-act="row-save">노란 칸 저장하기 (Enter)</button></div></div>';
}
function saveRow(){
  var a=numVal('rStart'), b=numVal('rEnd');
  var f={vid:curVid(),date:$('rDate').value,startTime:$('rST').value,endTime:$('rET').value,driver:$('rDriver').value.trim(),purpose:$('rPurpose').value||'기타',dest:$('rDest').value.trim(),
    startKm:isNaN(a)?'':a,endKm:isNaN(b)?'':b,riders:numVal('rRiders')||0,guardian:$('rGuard').value.trim(),drvOk:$('rDrvOk').checked,guardOk:$('rGuardOk').checked,
    checks:$('rChk').checked?CHECKS.map(function(c){return c.k;}):[],checkNote:$('rNote').value.trim(),memo:''};
  var err=tripError(f,null,'r');
  if(err){$('rowErr').innerHTML='<div class="err">'+err+'</div>';return;}
  // 다음 줄에는 같은 날짜·목적·운전자·동승자를 남겨 둔다 (종이 일지를 옮겨 적을 때 편하게)
  rowKeep={date:f.date,purpose:f.purpose,driver:f.driver,guardian:f.guardian,riders:f.riders};
  var msg=commitTrip(null,f,rowOpenedAt||Date.now()); rowOpenedAt=0;
  ui.month=f.date.slice(0,7); render(); toast(msg); try{$('rST_box').querySelector('[data-act=ampm]').focus();}catch(e){}
}
function delTrip(id){
  var old=S.trips[id]; if(!old) return;
  if(isLocked(S,old.date.slice(0,7))){closeDlg();toast('마감한 달의 기록은 지울 수 없어요.');return;}
  var hadMax=(+old.endKm===odoOf(S,old.vid));
  applyOp({c:'trips',id:id,data:null}); send({c:'trips',id:id,data:null,prev:old}); syncOdo(old.vid,hadMax);
  delete $('dlg').dataset.trip; closeDlg(); toast('지웠어요.');
}
// 시범 사용 의견. 구글 시트판은 '의견' 시트에, 웹 링크판은 공유 저장소에 쌓인다.
var EASE=['아주 어려워요','어려워요','보통이에요','쉬워요','아주 쉬워요'], OLDTIME=['1분 안','1~3분','3~5분','5분 넘게','안 써 봤어요'];
function fbForm(){
  var mine=vals(S.trips).filter(function(t){return t.by===me&&t.secs>0;}).map(function(t){return t.secs;});
  openDlg('<header><h2>의견 보내기</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
   buddy('ok','써 보시니 어떠셨어요?','솔직하게 적어 주시면 더 쓰기 쉽게 고칠게요. 아는 것만 적으셔도 돼요.')+
   '<div class="field"><span class="lab" id="fEaseLab">쓰기 쉬웠나요?</span><div class="chips rate" role="group" aria-labelledby="fEaseLab">'+EASE.map(function(e,i){return '<button type="button" class="chip" aria-pressed="false" data-act="chip" data-f="fEase" data-v="'+(i+1)+'">'+e+'</button>';}).join('')+'</div><input type="hidden" id="fEase" value=""></div>'+
   chipsField('fOld','지금(종이나 엑셀)은 운행일지 1건 쓰는 데 얼마나 걸리세요?',OLDTIME,'',false)+
   '<div class="field"><label for="fConf">가장 헷갈린 버튼이나 글자</label><input class="in" id="fConf" placeholder="예: 동승자 확인이 뭔지 몰랐어요"></div>'+
   '<div class="field"><label for="fGood">좋았던 점</label><input class="in" id="fGood"></div>'+
   '<div class="field"><label for="fWish">있었으면 하는 것</label><input class="in" id="fWish" placeholder="예: 주유 기록도 했으면 좋겠어요"></div>'+
   '<div class="field"><label for="fName">이름 <span class="muted small">(적지 않아도 돼요)</span></label><input class="in" id="fName" value="'+esc(me)+'"></div>'+
   (mine.length?'<p class="muted small">이 기기에서 운행 기록 '+mine.length+'건을 평균 '+Math.round(mine.reduce(function(a,b){return a+b;},0)/mine.length)+'초에 적으셨어요. 이 숫자도 함께 보내져요.</p>':'')+
   '<div id="fErr" role="alert"></div></div><footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="fb-save">보내기</button></footer>');
}
function saveFb(){
  var f={at:new Date().toISOString(),by:$('fName').value.trim(),ease:+$('fEase').value||0,oldTime:$('fOld').value,confusing:$('fConf').value.trim(),good:$('fGood').value.trim(),wish:$('fWish').value.trim(),device:innerWidth<700?'휴대폰':'PC'};
  if(!f.ease&&!f.confusing&&!f.good&&!f.wish&&!f.oldTime){$('fErr').innerHTML='<div class="err">하나라도 골라 주시거나 적어 주세요.</div>';return;}
  var mine=vals(S.trips).filter(function(t){return t.by===me&&t.secs>0;}).map(function(t){return t.secs;});
  f.trips=mine.length; f.avgSecs=mine.length?Math.round(mine.reduce(function(a,b){return a+b;},0)/mine.length):0;
  put('feedback',newId(),f); closeDlg(); toast('의견을 보냈어요. 고맙습니다!');
}
// 사용 방법: 바탕화면·홈 화면에 두는 법 + 매일 쓰는 법. 인쇄해서 PC 옆에 붙여 둘 수 있다.
var HELP=[
 ['PC 바탕화면에 두기',[
  '<b>가장 쉬운 방법:</b> 받은 파일 <b>「차량 지킴이 열기」</b>를 바탕화면에 복사해 두세요. 두 번 누르면 바로 열려요.',
  '<b>크롬에서:</b> 차량 지킴이를 연 채로 오른쪽 위 <span class="key">⋮</span> → <b>전송, 저장, 공유</b> → <b>바로가기 만들기</b> → <b>창으로 열기</b>에 체크 → <b>만들기</b>. 바탕화면에 아이콘이 생겨요.',
  '<b>엣지·크롬 공통:</b> 브라우저 창을 조금 작게 한 뒤, 주소창 맨 왼쪽의 자물쇠(또는 ⓘ) 표시를 마우스로 꾹 눌러 <b>바탕화면으로 끌어다 놓아도</b> 돼요.',
  '메뉴 이름은 브라우저 버전에 따라 조금 다를 수 있어요. 비슷한 이름을 찾아 주세요.']],
 ['휴대폰 홈 화면에 두기',[
  '<b>갤럭시(삼성 인터넷):</b> 아래쪽 <span class="key">≡</span> → <b>현재 페이지 추가</b> → <b>홈 화면</b>.',
  '<b>갤럭시(크롬):</b> 오른쪽 위 <span class="key">⋮</span> → <b>홈 화면에 추가</b> → <b>추가</b>.',
  '<b>아이폰(사파리):</b> 아래쪽 공유 단추 <span class="key">□↑</span> → <b>홈 화면에 추가</b> → <b>추가</b>.',
  '처음 한 번만 센터 암호를 적으면 그 휴대폰이 기억해요.']],
 ['운행 기록 적기 (매일)',[
  '운행을 마치면 <b>[오늘 운행 기록하기]</b>를 눌러요. 등원·하원처럼 늘 같은 운행은 <b>「자주 하는 운행 바로 적기」</b> 단추를 누르면 지난번 내용이 미리 채워져요.',
  '<b>도착했을 때 계기판 km</b>만 적으면 운행 거리는 저절로 계산돼요.',
  '<b>[모두 이상 없음]</b>, 운전자 확인, 동승자 확인에 표시하고 <b>[저장하기]</b>를 꼭 눌러 주세요.']],
 ['종이 일지와 함께 쓰기 (PC)',[
  '지금처럼 종이에 먼저 적어도 괜찮아요.',
  'PC에서 <b>[운행일지]</b> 탭을 열면 표 바로 아래에 <b>노란 칸</b>이 있어요. 종이 일지를 보며 한 줄씩 옮겨 적고 <span class="key">Enter</span>를 누르면 저장돼요. 칸 사이는 <span class="key">Tab</span>으로 옮겨요.',
  '저장하면 같은 날짜·운전자·동승자가 다음 줄에 남아 있어서 여러 줄을 빨리 적을 수 있어요.']],
 ['주유·정비 영수증 붙이기',[
  '<b>[점검·정비]</b> 탭 → <b>[+ 주유·구입 기록하기]</b>에서 금액을 적고 <b>[저장하고 영수증 양식 인쇄]</b>를 눌러요.',
  '인쇄한 종이 왼쪽에 <b>영수증 원본</b>, 오른쪽에 <b>사본</b>을 붙이면 나란히 비교할 수 있어요.',
  '엔진오일처럼 주기가 있는 정비는 그 항목의 <b>[교환했어요]</b>로 적으면 다음 교환 시기도 계산돼요.',
  '주유할 때는 영수증의 <b>주유량(리터)</b>도 적어 주세요. <b>[운행일지]</b> 탭의 <b>[유류수불대장 인쇄]</b>로 지침 양식의 유류수불대장이 나와요.',
  '구청에 청구할 때는 <b>[운행일지]</b> 탭 → 그 달로 옮긴 뒤 <b>[청구용 인쇄 (일지+영수증)]</b>를 누르면 운행일지, 유류수불대장, 지출 내역, 영수증 양식이 한 번에 나와요.']]
];
function helpBody(){ return HELP.map(function(h,i){return '<div class="howto"><h3><span class="pill unk">'+(i+1)+'</span>'+h[0]+'</h3><ol class="steps">'+h[1].map(function(x){return '<li>'+x+'</li>';}).join('')+'</ol></div>';}).join(''); }
function helpDlg(){
  openDlg('<header><h2>사용 방법</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
    buddy('ok','처음이라 낯설어도 괜찮아요.','아래 순서대로 한 번만 해 두면 다음부터는 아이콘만 누르면 돼요.')+helpBody()+
    '</div><footer><button type="button" class="btn" data-act="help-print">이 안내 인쇄하기</button><button type="button" class="btn main" data-act="dlg-close">알겠어요</button></footer>');
}
function printHelp(){
  var css='@page hp{size:A4 portrait;margin:14mm}.hp{page:hp;font-family:"Malgun Gothic","Noto Sans KR",sans-serif;color:#000;font-size:11.5pt;line-height:1.6}.hp h1{font-size:20pt;margin:0 0 4mm}.hp h3{font-size:13pt;margin:5mm 0 1mm}.hp .pill{display:inline-block;border:1px solid #000;border-radius:50%;width:7mm;text-align:center;margin-right:2mm}.hp ol{margin:0;padding-left:6mm}.hp li{margin:1mm 0}.hp .key{border:1px solid #000;border-radius:3px;padding:0 3px}.hp .howto{break-inside:avoid}';
  printOut('<div class="hp"><h1>차량 지킴이 사용 방법</h1>'+helpBody()+'</div>',css,'차량지킴이_사용방법','세로');
}
function seasonDlg(){
  var s=seasonOf(today());
  openDlg('<header><h2>'+s.name+'에 챙길 것</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+buddy('unk',s.line,'어렵지 않아요. 하나씩만 봐 주세요.')+'<ul class="tips">'+s.items.map(function(x){var i=x.indexOf(':');return '<li>'+(i>0?'<b>'+esc(x.slice(0,i))+'</b>'+esc(x.slice(i)):esc(x))+'</li>';}).join('')+'</ul><p class="muted small">일반적인 관리 요령이에요. 잘 모르겠으면 정비소에 "'+s.name+' 점검 부탁드려요"라고만 말해도 돼요.</p></div><footer><button type="button" class="btn main" data-act="dlg-close">알겠어요</button></footer>');
}
function svcForm(k){
  var it=ITEMS.filter(function(i){return i.k===k;})[0], vid=curVid(), iv=intervalOf(S.vehicles[vid],it);
  openDlg('<header><h2>'+esc(it.full)+' 교환 기록</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
   '<p class="muted">'+esc(it.tip)+'. 주기: '+[iv.km?fmtKm(iv.km)+'km':'',iv.mo?iv.mo+'개월':''].filter(Boolean).join(' 또는 ')+' (먼저 오는 쪽)</p>'+
   '<div class="two"><div class="field"><label for="sDate">교환한 날</label><input class="in" type="date" id="sDate" value="'+today()+'"></div>'+
   '<div class="field"><label for="sKm">그때 계기판 km</label><input class="in km" id="sKm" inputmode="numeric" value="'+odoOf(S,vid)+'"><span class="hint">모르면 비워 두세요. 날짜로만 계산해요.</span></div></div>'+
   '<div class="two"><div class="field"><label for="sCost">비용(원) <span class="muted small">(선택)</span></label><input class="in" id="sCost" inputmode="numeric" placeholder="예: 85000"></div>'+
   '<div class="field"><label for="sShop">정비소 <span class="muted small">(선택)</span></label><input class="in" id="sShop" placeholder="예: ○○카센터"></div></div>'+
   '<div class="field"><label for="sMemo">내용 <span class="muted small">(선택 · 영수증 양식에 들어가요)</span></label><input class="in" id="sMemo" placeholder="예: 엔진오일 6L, 오일필터 교환"></div><div id="sErr" role="alert"></div></div>'+
   '<footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn" data-act="svc-save" data-v="'+k+'" data-p="1">저장하고 영수증 양식 인쇄</button><button type="button" class="btn main" data-act="svc-save" data-v="'+k+'">저장하기</button></footer>');
}
function saveSvc(k,andPrint){
  if(!$('sDate').value){$('sErr').innerHTML='<div class="err">교환한 날을 골라 주세요.</div>';return;}
  if($('sDate').value>today()){$('sErr').innerHTML='<div class="err">오늘보다 뒤의 날짜예요. 날짜를 다시 봐 주세요.</div>';return;}
  var km=numVal('sKm'), it=ITEMS.filter(function(i){return i.k===k;})[0], id=newId();
  put('services',id,{vid:curVid(),item:k,itemName:it?it.full:k,date:$('sDate').value,km:isNaN(km)?0:km,cost:numVal('sCost')||0,shop:$('sShop').value.trim(),memo:$('sMemo').value.trim(),by:me,ts:Date.now()});
  closeDlg(); toast('교환 기록을 저장했어요. 다음 시기를 다시 계산했습니다.');
  if(andPrint) printReceipts([id]);
}
// 주유·세차·구입처럼 점검 주기와 상관없는 지출
function expForm(){
  var vid=curVid();
  openDlg('<header><h2>주유·구입 기록하기</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
   chipsField('eKind','무엇에 썼나요?',EXPS.map(function(e){return e.n;}),'주유',false)+
   '<p class="muted small">엔진오일·타이어처럼 <b>주기가 있는 정비</b>는 [점검·정비] 목록의 [교환했어요]로 적으면 다음 시기도 계산하고 영수증 양식도 인쇄할 수 있어요.</p>'+
   '<div class="two"><div class="field"><label for="eDate">날짜</label><input class="in" type="date" id="eDate" value="'+today()+'" max="'+today()+'"></div>'+
   '<div class="field"><label for="eCost">금액(원)</label><input class="in km" id="eCost" inputmode="numeric" placeholder="예: 50000"></div></div>'+
   '<div class="two"><div class="field"><label for="eShop">사용처 <span class="muted small">(선택)</span></label><input class="in" id="eShop" placeholder="예: ○○주유소"></div>'+
   '<div class="field"><label for="eKm">그때 계기판 km</label><input class="in" id="eKm" inputmode="numeric" value="'+odoOf(S,vid)+'"><span class="hint">유류수불대장의 주행거리 칸에 들어가요.</span></div></div>'+
   '<div class="field" id="eLitBox"><label for="eLit">주유량(리터) <span class="muted small">(주유일 때 · 영수증에 적힌 리터)</span></label><input class="in km" id="eLit" inputmode="decimal" placeholder="예: 35.2"></div>'+
   '<div class="field"><label for="eMemo">내용 <span class="muted small">(선택)</span></label><input class="in" id="eMemo" placeholder="예: 경유, 체험활동 다녀오며 주유"></div><div id="eErr" role="alert"></div></div>'+
   '<footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn" data-act="exp-save" data-p="1">저장하고 영수증 양식 인쇄</button><button type="button" class="btn main" data-act="exp-save">저장하기</button></footer>');
}
function saveExp(andPrint){
  var d=$('eDate').value, cost=numVal('eCost'), kind=$('eKind').value||'기타 지출', e=EXPS.filter(function(x){return x.n===kind;})[0]||EXPS[EXPS.length-1], km=numVal('eKm');
  if(!d){$('eErr').innerHTML='<div class="err">날짜를 골라 주세요.</div>';return;}
  if(d>today()){$('eErr').innerHTML='<div class="err">오늘보다 뒤의 날짜예요.</div>';return;}
  if(isNaN(cost)||!cost){$('eErr').innerHTML='<div class="err">금액을 숫자로 적어 주세요.</div>';return;}
  var lit=parseFloat(String($('eLit').value).replace(/[^0-9.]/g,''))||0;
  if(e.k==='fuel'&&!lit){$('eErr').innerHTML='<div class="err">주유량(리터)을 적어 주세요. 유류수불대장에 들어가요. 영수증에 적혀 있어요.</div>';return;}
  var id=newId();
  put('services',id,{vid:curVid(),item:e.k,itemName:e.n,date:d,km:isNaN(km)?0:km,cost:cost,liters:e.k==='fuel'?Math.round(lit*100)/100:0,shop:$('eShop').value.trim(),memo:$('eMemo').value.trim(),by:me,ts:Date.now()});
  closeDlg(); toast(e.n+' '+fmtKm(cost)+'원을 저장했어요.');
  if(andPrint) printReceipts([id]);
}
function vehForm(id){
  var v=id?S.vehicles[id]:{name:'',plate:'',baseOdo:'',severe:true,fuel:'경유',inspDate:'',insDate:''};
  openDlg('<header><h2>'+(id?'차량 고치기':'차량 등록하기')+'</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
   '<div class="two"><div class="field"><label for="vName">차 이름</label><input class="in" id="vName" value="'+esc(v.name)+'" placeholder="예: 노랑버스, 스타리아"></div>'+
   '<div class="field"><label for="vPlate">차량 번호 <span class="muted small">(선택)</span></label><input class="in" id="vPlate" value="'+esc(v.plate||'')+'" placeholder="예: 12가 3456"></div></div>'+
   '<div class="two"><div class="field"><label for="vOdo">지금 계기판 숫자 (km)</label><input class="in km" id="vOdo" inputmode="numeric" value="'+(id?odoOf(S,id):'')+'" placeholder="총 주행거리"><span class="hint">운행일지를 적으면 자동으로 올라가요.</span></div>'+
   chipsField('vFuel','연료',FUELS,v.fuel||'경유',false)+'</div>'+
   '<label class="check"><input type="checkbox" id="vSevere" '+(v.severe?'checked':'')+'><span><b>짧은 거리를 자주 다녀요 (등·하원 위주)</b><br><span class="muted small">시동을 자주 걸고 끄면 엔진오일이 빨리 나빠져요. 체크하면 엔진오일을 5,000km 또는 6개월로 더 일찍 알려 드려요.</span></span></label>'+
   '<div class="two"><div class="field"><label for="vInsp">정기검사 유효기간 만료일</label><input class="in" type="date" id="vInsp" value="'+(v.inspDate||'')+'"><span class="hint">자동차등록증 아래쪽 검사 유효기간의 끝 날짜</span></div>'+
   '<div class="field"><label for="vIns">보험 만기일</label><input class="in" type="date" id="vIns" value="'+(v.insDate||'')+'"><span class="hint">보험증권에 적힌 끝 날짜</span></div></div><div id="vErr" role="alert"></div></div>'+
   '<footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="veh-save" data-v="'+(id||'')+'">저장하기</button></footer>');
}
function saveVeh(id){
  var name=$('vName').value.trim(), odo=numVal('vOdo');
  if(!name){$('vErr').innerHTML='<div class="err">차 이름을 적어 주세요.</div>';return;}
  if(isNaN(odo)){$('vErr').innerHTML='<div class="err">지금 계기판 숫자(km)를 적어 주세요.</div>';return;}
  var old=id?S.vehicles[id]:{}, nid=id||newId();
  if(id && odo<odoOf(S,id)){ // 운행일지·정비 기록보다 작게는 내릴 수 없다
    S.vehicles[id]=Object.assign({},old,{baseOdo:0,odo:0}); var floor=odoOf(S,id); S.vehicles[id]=old;
    if(odo<floor){$('vErr').innerHTML='<div class="err">운행일지나 정비 기록에 적힌 km('+fmtKm(floor)+')보다 작게는 고칠 수 없어요. 그 기록의 숫자를 먼저 고쳐 주세요.</div>';return;}
  }
  var v=Object.assign({},old,{name:name,plate:$('vPlate').value.trim(),baseOdo:odo,odo:odo,fuel:$('vFuel').value||'경유',severe:$('vSevere').checked,inspDate:$('vInsp').value,insDate:$('vIns').value,ts:old.ts||Date.now()});
  delete v.ex; put('vehicles',nid,v); ui.vid=nid; LS.set('cj.ui',{vid:nid});
  closeDlg(); toast('차량을 저장했어요.');
}
function drvForm(id){
  var d=id?S.drivers[id]:{name:'',edu:''};
  openDlg('<header><h2>운전하는 선생님</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body">'+
   '<div class="field"><label for="dName">이름</label><input class="in" id="dName" value="'+esc(d.name)+'"></div>'+
   '<div class="field"><label for="dEdu">통학버스 안전교육을 마지막으로 받은 날</label><input class="in" type="date" id="dEdu" value="'+(d.edu||'')+'" max="'+today()+'"><span class="hint">교육 수료증에 적힌 날짜. 모르면 비워 두세요.</span></div><div id="dErr" role="alert"></div></div>'+
   '<footer>'+(id?'<button type="button" class="btn danger" data-act="drv-del" data-v="'+id+'">지우기</button><span class="grow"></span>':'')+'<button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="drv-save" data-v="'+(id||'')+'">저장하기</button></footer>');
}
function ivForm(){
  var v=S.vehicles[curVid()];
  openDlg('<header><h2>점검 주기 고치기</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body"><p class="muted">km와 개월 중 먼저 오는 쪽으로 알려 드려요. 쓰지 않는 칸은 0으로 두세요.</p>'+
   itemsFor(v).map(function(it){var iv=intervalOf(v,it);return '<div class="field"><span class="lab">'+esc(it.full)+'</span><div class="two"><label class="row"><input class="in num" style="flex:1" id="ivk_'+it.k+'" inputmode="numeric" value="'+iv.km+'" aria-label="'+esc(it.full)+' km 주기"><span>km</span></label><label class="row"><input class="in num" style="flex:1" id="ivm_'+it.k+'" inputmode="numeric" value="'+iv.mo+'" aria-label="'+esc(it.full)+' 개월 주기"><span>개월</span></label></div></div>';}).join('')+
   '<label class="check"><input type="checkbox" id="ivChk" '+(v.ivChecked?'checked':'')+'><span><b>차량 설명서로 확인했어요</b><br><span class="muted small">표시하면 계산 근거에 \'일반 권장 주기\' 대신 \'차량 설명서로 확인한 주기\'라고 나와요.</span></span></label></div>'+
   '<footer><button type="button" class="btn" data-act="iv-reset">기본값으로 되돌리기</button><span class="grow"></span><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="iv-save">저장하기</button></footer>');
}
function confirmDlg(msg,act,v,yes){
  openDlg('<header><h2>확인</h2></header><div class="body"><p>'+msg+'</p></div><footer><button type="button" class="btn" data-act="dlg-close">아니요</button><button type="button" class="btn '+(yes?'main':'danger')+'" data-act="'+act+'" data-v="'+esc(v||'')+'">'+(yes||'네, 지울게요')+'</button></footer>');
}

/* ============ 5. 인쇄·엑셀·달력·백업 ============ */
function sheetHtml(vid,month){
  var v=S.vehicles[vid], list=tripsOf(vid,month), total=0, kids=0, appr=(S.settings.approvers||'담당자/시설장').split('/').map(function(s){return s.trim();}).filter(Boolean);
  var rows=list.map(function(e,i){var t=e[1];total+=t.endKm-t.startKm;kids+=(+t.riders||0);return '<tr><td>'+(i+1)+'</td><td>'+t.date.slice(5).replace('-','.')+'.</td><td>'+esc(t.startTime||'')+'</td><td>'+esc(t.endTime||'')+'</td><td>'+esc(t.purpose)+(t.dest?'<br>'+esc(t.dest):'')+'</td><td class="r">'+fmtKm(t.startKm)+'</td><td class="r">'+fmtKm(t.endKm)+'</td><td class="r">'+fmtKm(t.endKm-t.startKm)+'</td><td>'+esc(t.driver)+(t.drvOk?' (확인)':'')+'</td><td>'+esc(t.guardian||'')+(t.guardian&&t.guardOk?' (확인)':'')+'</td><td class="l">'+esc(checkText(t))+'</td><td>'+(t.riders||0)+'</td><td class="l">'+esc(t.memo||'')+'</td></tr>';}).join('');
  for(var i=list.length;i<Math.max(list.length,10);i++) rows+='<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  return '<div class="ps"><div class="ph"><div><h1>차량 운행일지</h1><p>'+esc(S.settings.center||'')+' &nbsp; '+month.replace('-','년 ')+'월 &nbsp; 차량: '+esc(v.name)+' '+esc(v.plate||'')+(isLocked(S,month)?' &nbsp; (마감)':'')+'</p></div>'+
    '<table class="ap"><tr><th rowspan="2">결<br>재</th>'+appr.map(function(a){return '<th>'+esc(a)+'</th>';}).join('')+'</tr><tr>'+appr.map(function(){return '<td></td>';}).join('')+'</tr></table></div>'+
    '<table class="pt"><thead><tr><th>번호</th><th>일자</th><th>출발<br>시간</th><th>도착<br>시간</th><th>운행 목적</th><th>출발 km</th><th>도착 km</th><th>운행<br>거리</th><th>운전자<br>확인</th><th>동승자<br>확인</th><th>차량 점검 내용</th><th>탑승<br>아동</th><th>비고</th></tr></thead><tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="7">합계 ('+list.length+'회)</td><td class="r">'+fmtKm(total)+'km</td><td colspan="3"></td><td>'+kids+'명</td><td></td></tr></tfoot></table></div>';
}
var PRINT_CSS='@page{size:A4 landscape;margin:12mm}.ps{font-family:"Malgun Gothic","Noto Sans KR",sans-serif;color:#000;font-size:10pt}.ps h1{font-size:20pt;margin:0 0 4pt}.ps p{margin:0}.ph{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8pt}.ps table{border-collapse:collapse}.ps th,.ps td{border:1px solid #000;padding:4pt 5pt;text-align:center;white-space:normal;background:none;color:#000}.pt{width:100%}.pt th{background:#eee}.ps .r{text-align:right}.ps{font-size:9pt}.ps td,.ps th{white-space:nowrap;overflow-wrap:normal;word-break:keep-all}.ps .l{text-align:left;white-space:normal}.ps .ap{width:auto;flex:none}.ps .ph>div{flex:1}.ps tr{break-inside:avoid}.ap td{width:22mm;height:16mm}.ap th{font-weight:normal;padding:2pt 6pt}.ps,.rs{padding:0 1.5px}';
// 파일로 내려받기. 웹 링크판은 Claude의 저장 기능을, 그 밖에는 브라우저 내려받기를 쓴다.
function saveFile(name,text,type,okMsg){
  if(inClaude){
    if(!downloadsCap){toast('이 화면에서는 파일 저장을 쓸 수 없어요. PC에서 다시 열어 주세요.');return;}
    downloadsCap.save({filename:name,data:text}).then(function(){toast(okMsg);}).catch(function(e){ if(e&&e.code!=='declined') toast('파일을 저장하지 못했어요.'); });
    return;
  }
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); toast(okMsg);
}
function doPrint(){ printOut(sheetHtml(curVid(),ui.month),PRINT_CSS,'차량운행일지_'+ui.month,'가로'); }
// 인쇄. 웹 링크판은 인쇄용 파일을 내려받게 한다.
function printOut(html,css,fname,dir){
  if(inClaude){
    var doc='<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>'+esc(fname)+'</title><style>'+css+'body{margin:10mm}.tip{font-family:sans-serif;background:#fff3c4;padding:10px;margin-bottom:12px}@media print{.tip{display:none}body{margin:0}}</style></head><body><div class="tip">이 파일을 연 뒤 Ctrl + P 를 누르면 인쇄할 수 있어요. (용지 방향: '+dir+')</div>'+html+'</body></html>';
    saveFile(fname+'.html',doc,'text/html','저장했어요. 내려받은 파일을 열고 Ctrl+P로 인쇄하세요.'); return;
  }
  $('printArea').innerHTML='<style>'+css+'</style>'+html; window.print();
}
/* --- 영수증 양식 (지출 증빙서): 세로 A4 한 장. 왼쪽에 원본, 오른쪽에 사본을 붙여 나란히 비교한다 --- */
var RC_CSS='@page port{size:A4 portrait;margin:12mm}.rc{page:port;font-family:"Malgun Gothic","Noto Sans KR",sans-serif;color:#000;font-size:10.5pt;display:flex;flex-direction:column;gap:5mm;height:268mm;box-sizing:border-box;padding:0 1.5px}'+
  '.rc+.rc,.ps+.rc,.rs+.rc,.ps+.rs{break-before:page}.rs{page:port;font-family:"Malgun Gothic","Noto Sans KR",sans-serif;color:#000;font-size:10.5pt}'+
  '.rc h1,.rs h1{font-size:19pt;margin:0;letter-spacing:2pt}.rc .hd{display:flex;justify-content:space-between;align-items:flex-end;gap:6mm}.rc .hd p{margin:1mm 0 0;font-size:10pt}'+
  '.rc table,.rs table{border-collapse:collapse}.rc th,.rc td,.rs th,.rs td{border:1px solid #000;padding:2.2mm 2.5mm;text-align:left;color:#000;background:none;white-space:normal}.rc th,.rs th{background:#eee;width:24mm;text-align:center;font-weight:bold}'+
  '.rc .info{width:100%}.rc .info td{height:6mm}.rc .ap{width:auto}.rc .ap th{width:auto;font-weight:normal;padding:1mm 4mm}.rc .ap td{width:20mm;height:14mm}'+
  '.rc .boxes{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4mm;min-height:0}.rc .box{border:1.5px dashed #000;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:4mm;text-align:center}'+
  '.rc .box b{font-size:13pt}.rc .box span{font-size:9pt;color:#333;margin-top:1mm}.rc .ft{text-align:center;line-height:1.9}.rc .ft .sig{text-align:right;margin-top:1mm}'+
  '.rs .sum{width:100%;margin-top:4mm}.rs .r{text-align:right}.rs th{width:auto}';
function receiptHtml(s){
  var v=S.vehicles[(s&&s.vid)||curVid()]||{}, appr=(S.settings.approvers||'담당자/시설장').split('/').map(function(x){return x.trim();}).filter(Boolean);
  var blank=!s; s=s||{};
  var dt=s.date?s.date.split('-'):null, line='&nbsp;';
  return '<div class="rc"><div class="hd"><div><h1>지출 증빙서</h1><p>(영수증 첨부용) &nbsp; '+esc(S.settings.center||'')+'</p></div>'+
    '<table class="ap"><tr><th rowspan="2">결<br>재</th>'+appr.map(function(a){return '<th>'+esc(a)+'</th>';}).join('')+'</tr><tr>'+appr.map(function(){return '<td></td>';}).join('')+'</tr></table></div>'+
    '<table class="info"><tr><th>차량</th><td>'+esc((v.name||'')+' '+(v.plate||''))+'</td><th>지출일</th><td>'+(dt?dt[0]+'년 '+(+dt[1])+'월 '+(+dt[2])+'일':'&nbsp; &nbsp; &nbsp; 년 &nbsp; &nbsp; 월 &nbsp; &nbsp; 일')+'</td></tr>'+
    '<tr><th>항목</th><td>'+(blank?line:esc(svcName(s)))+'</td><th>금액</th><td>'+(s.cost?fmtKm(s.cost)+' 원':'<span style="float:right">원</span>')+'</td></tr>'+
    '<tr><th>사용처</th><td>'+(esc(s.shop||'')||line)+'</td><th>그때 km</th><td>'+(s.km?fmtKm(s.km)+' km':'<span style="float:right">km</span>')+'</td></tr>'+
    '<tr><th>내용</th><td colspan="3">'+(esc([s.liters?'주유량 '+s.liters+'L':'',s.memo||''].filter(Boolean).join(' · '))||line)+'</td></tr>'+
    '<tr><th>작성자</th><td>'+(esc(s.by||'')||line)+'</td><th>확인자</th><td>'+line+'</td></tr></table>'+
    '<div class="boxes"><div class="box"><b>영수증 원본</b><span>여기에 원본을 붙여 주세요</span></div><div class="box"><b>영수증 사본</b><span>여기에 복사본을 붙여 주세요</span></div></div>'+
    '<div class="ft">위와 같이 차량 운영비를 지출하였음을 확인합니다.<div class="sig">'+(dt?dt[0]:'20&nbsp;&nbsp;&nbsp;')+'년 &nbsp; &nbsp; 월 &nbsp; &nbsp; 일 &nbsp; &nbsp; 작성자 &nbsp; '+(esc(s.by||'')||'&nbsp; &nbsp; &nbsp; &nbsp; &nbsp;')+' &nbsp; (서명)</div></div></div>';
}
function printReceipts(ids){
  var list=ids?ids.map(function(id){return S.services[id];}).filter(Boolean):[null];
  printOut(list.map(receiptHtml).join(''),RC_CSS,list[0]?'지출증빙서_'+list[0].date:'지출증빙서_빈양식','세로');
}
/* --- 유류수불대장: 지역아동센터 운영지침 별첨 양식의 칸(연번·일자·주유량·금액·주행거리·비고·결재 담당/시설장) --- */
function fuelsOf(vid,month){ return vals(S.services).filter(function(s){return s.vid===vid&&s.item==='fuel'&&s.date.slice(0,7)===month;}).sort(function(a,b){return (a.date+String(a.km||0).padStart(8,'0')).localeCompare(b.date+String(b.km||0).padStart(8,'0'));}); }
function fuelLedgerHtml(vid,month){
  var v=S.vehicles[vid], list=fuelsOf(vid,month), L=0, W=0;
  var rows=list.map(function(s,i){L+=+s.liters||0; W+=+s.cost||0; return '<tr><td>'+(i+1)+'</td><td>'+fmtD(s.date)+'</td><td class="r">'+(s.liters?s.liters.toLocaleString('ko-KR',{maximumFractionDigits:2})+' L':'')+'</td><td class="r">'+(s.cost?fmtKm(s.cost)+'원':'')+'</td><td class="r">'+(s.km?fmtKm(s.km)+' km':'')+'</td><td class="l">'+esc([s.shop,s.memo].filter(Boolean).join(' · '))+'</td><td></td><td></td></tr>';}).join('');
  for(var i=list.length;i<Math.max(list.length,15);i++) rows+='<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  return '<div class="fl"><h1>유류수불대장</h1><p>'+esc(S.settings.center||'')+' &nbsp; '+month.replace('-','년 ')+'월 &nbsp; 차량번호: '+esc(v.plate||'')+' ('+esc(v.name)+') &nbsp; 연료: '+esc(v.fuel||'')+'</p>'+
    '<table><thead><tr><th rowspan="2">연번</th><th rowspan="2">일자</th><th rowspan="2">주유량</th><th rowspan="2">금액</th><th rowspan="2">주행거리<br><span>(주유 때 계기판)</span></th><th rowspan="2">비고<br><span>(주유소·내용)</span></th><th colspan="2">결재</th></tr><tr><th>담당</th><th>시설장</th></tr></thead><tbody>'+rows+'</tbody>'+
    '<tfoot><tr><td colspan="2">합계 ('+list.length+'회)</td><td class="r">'+L.toLocaleString('ko-KR',{maximumFractionDigits:2})+' L</td><td class="r">'+fmtKm(W)+'원</td><td colspan="4"></td></tr></tfoot></table>'+
    '<p class="nt">※ 지역아동센터 운영지침의 유류수불대장 칸을 따랐어요. 주유 기록([점검·정비] → [+ 주유·구입 기록하기])에서 채워지고, 빈 줄은 손으로 적어도 돼요.</p></div>';
}
var FL_CSS='@page port{size:A4 portrait;margin:12mm}.fl{page:port;font-family:"Malgun Gothic","Noto Sans KR",sans-serif;color:#000;font-size:10.5pt;padding:0 1.5px}.ps+.fl,.fl+.rs,.fl+.rc{break-before:page}'+
  '.fl h1{font-size:20pt;letter-spacing:4pt;text-align:center;margin:0 0 3mm}.fl p{margin:0 0 3mm}.fl table{width:100%;border-collapse:collapse}.fl th,.fl td{border:1px solid #000;padding:2.4mm 2mm;text-align:center;color:#000;background:none}.fl th{background:#eee}.fl th span{font-size:8pt;font-weight:normal}'+
  '.fl td{height:6mm}.fl .r{text-align:right}.fl .l{text-align:left}.fl tfoot td{font-weight:bold}.fl .nt{font-size:8.5pt;margin-top:2mm}';
function doFuel(){ var vid=curVid(); printOut(fuelLedgerHtml(vid,ui.month),FL_CSS,'유류수불대장_'+ui.month,'세로'); if(!fuelsOf(vid,ui.month).length) toast('이 달에 적은 주유 기록이 없어 빈 양식을 인쇄해요.'); }
function monthExpenses(vid,month){
  return vals(S.services).filter(function(s){return s.vid===vid&&s.date.slice(0,7)===month&&+s.cost>0;}).sort(function(a,b){return a.date.localeCompare(b.date);});
}
// 구청 청구용: 그 달 운행일지(가로) + 지출 내역 + 지출마다 영수증 양식(세로)을 한 번에 인쇄한다
function doClaim(){
  var vid=curVid(), ex=monthExpenses(vid,ui.month), total=0;
  var sum='<div class="rs"><h1>차량 운영비 지출 내역</h1><p style="margin:2mm 0 0">'+esc(S.settings.center||'')+' &nbsp; '+ui.month.replace('-','년 ')+'월 &nbsp; 차량: '+esc(S.vehicles[vid].name)+' '+esc(S.vehicles[vid].plate||'')+'</p>'+
    '<table class="sum"><thead><tr><th>번호</th><th>날짜</th><th>항목</th><th>사용처</th><th>내용</th><th class="r">금액</th></tr></thead><tbody>'+
    (ex.length?ex.map(function(s,i){total+=+s.cost;return '<tr><td>'+(i+1)+'</td><td>'+fmtD(s.date)+'</td><td>'+esc(svcName(s))+'</td><td>'+esc(s.shop||'')+'</td><td>'+esc(s.memo||'')+'</td><td class="r">'+fmtKm(s.cost)+'원</td></tr>';}).join(''):'<tr><td colspan="6" style="text-align:center">이 달에 적은 지출이 없어요</td></tr>')+
    '</tbody><tfoot><tr><th colspan="5">합계</th><td class="r"><b>'+fmtKm(total)+'원</b></td></tr></tfoot></table></div>';
  printOut(sheetHtml(vid,ui.month)+(fuelsOf(vid,ui.month).length?fuelLedgerHtml(vid,ui.month):'')+sum+(ex.length?ex.map(receiptHtml).join(''):receiptHtml(null)),PRINT_CSS+FL_CSS+RC_CSS,'청구용_'+ui.month,'운행일지는 가로, 영수증은 세로');
}
function csvOf(rows){var q=function(s){return '"'+String(s==null?'':s).replace(/"/g,'""')+'"';}; return '﻿'+rows.map(function(r){return r.map(q).join(',');}).join('\r\n');}
function doCsv(){
  var rows=[['일자','출발시간','도착시간','운행목적','목적지','출발km','도착km','운행거리km','운전자','운전자확인','동승자','동승자확인','차량점검내용','탑승아동수','메모','적은 사람']];
  tripsOf(curVid(),ui.month).forEach(function(e){var t=e[1];rows.push([t.date,t.startTime,t.endTime,t.purpose,t.dest,t.startKm,t.endKm,t.endKm-t.startKm,t.driver,t.drvOk?'확인':'',t.guardian,t.guardOk?'확인':'',checkText(t),t.riders||0,t.memo,t.by]);});
  saveFile('차량운행일지_'+ui.month+'.csv',csvOf(rows),'text/csv','엑셀에서 열 수 있는 파일로 저장했어요.');
}
// 한글(.hwpx) 파일로 저장. 한글 2014 이후에서 열리고, 한글에서 [다른 이름으로 저장]을 하면 .hwp로도 바꿀 수 있다.
function doHwpx(){
  var name='차량운행일지_'+ui.month+'.hwpx', data;
  try{ data=buildHwpx(curVid(),ui.month); }catch(e){ toast('한글 파일을 만들지 못했어요.'); return; }
  if(inClaude){ toast('한글 파일은 구글 시트판이나 파일판에서 저장할 수 있어요. 여기서는 엑셀 파일이나 인쇄용 파일을 써 주세요.'); return; }
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type:'application/hwp+zip'})); a.download=name; document.body.appendChild(a); a.click(); a.remove();
  toast('한글 파일로 저장했어요. 한글에서 열어 고치거나 인쇄할 수 있어요.');
}
function doSvcCsv(){
  var vid=curVid(), name={}; ITEMS.forEach(function(i){name[i.k]=i.full;});
  var rows=[['날짜','항목','그때km','비용','주유량(L)','정비소','메모','적은 사람']];
  vals(S.services).filter(function(s){return s.vid===vid;}).sort(function(a,b){return a.date.localeCompare(b.date);}).forEach(function(s){rows.push([s.date,svcName(s),s.km||'',s.cost||'',s.liters||'',s.shop,s.memo,s.by]);});
  saveFile('정비이력_'+S.vehicles[vid].name+'.csv',csvOf(rows),'text/csv','정비 이력을 저장했어요.');
}
// 휴대폰·PC 달력에 넣는 파일(.ics). 기한 7일 전에 달력 앱이 알려 준다.
function doIcs(){
  var now=today(), v=S.vehicles[curVid()], n=0, L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//chajikimi//KO','CALSCALE:GREGORIAN'];
  alertsNow.forEach(function(a){
    if(a.st==='unk'||!a.when) return; var d=a.when<now?now:a.when, d2=addDays(d,1); n++;
    L.push('BEGIN:VEVENT','UID:'+a.key.replace(/[^a-z0-9]/gi,'')+'-'+curVid()+'@chajikimi','DTSTAMP:'+now.replace(/-/g,'')+'T000000Z','DTSTART;VALUE=DATE:'+d.replace(/-/g,''),'DTEND;VALUE=DATE:'+d2.replace(/-/g,''),
      'SUMMARY:['+v.name+'] '+a.full+(a.kind==='item'?' 교환':''),'DESCRIPTION:'+a.why.replace(/[,;]/g,' ')+(a.estD&&a.estD===a.when?' (주행거리로 어림한 날짜)':''),'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:차량 지킴이 알림','TRIGGER:-P7D','END:VALARM','END:VEVENT');
  });
  L.push('END:VCALENDAR');
  if(!n){toast('달력에 넣을 날짜가 아직 없어요. 교환 기록이나 날짜를 먼저 적어 주세요.');return;}
  saveFile('차량점검알림_'+v.name+'.ics',L.join('\r\n'),'text/calendar',n+'건을 달력 파일로 저장했어요. 파일을 열면 달력에 들어가요.');
}
function doBackup(){
  LS.set('cj.bk',Object.keys(S.trips).length+Object.keys(S.services).length);
  function out(trips){ saveFile('차량지킴이_백업_'+today()+'.json',JSON.stringify({schema:SCHEMA,savedAt:new Date().toISOString(),vehicles:S.vehicles,trips:trips,services:S.services,drivers:S.drivers,settings:S.settings}),'application/json','백업 파일을 저장했어요.'); }
  if(store.mode!=='cloud'){ out(S.trips); return; }
  // 웹 링크판은 화면에 최근 기록만 있으므로 석 달씩 나눠 5년 치를 모두 읽는다
  toast('전체 기록을 모으는 중이에요…');
  var all={}, jobs=[], y=+today().slice(0,4), m=+today().slice(5,7);
  for(var i=0;i<20;i++){ var a=new Date(y,m-1-i*3-2,1), b=new Date(y,m-i*3,0); jobs.push(cloud.db.collection('trips').where('date','>=',ymd(a)).where('date','<=',ymd(b)).limit(1000).get().then(function(snap){snap.docs.forEach(function(d){all[d.id]=d.data();});})); }
  Promise.all(jobs).then(function(){out(all);},function(){toast('기록을 모두 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.');});
}
function doRestore(file){
  var r=new FileReader();
  r.onload=function(){
    var d; try{d=JSON.parse(r.result);}catch(e){toast('백업 파일이 아니에요.');return;}
    if(!d||!d.vehicles||!d.trips){toast('차량 지킴이 백업 파일이 아니에요.');return;}
    var items=[]; COLLS.forEach(function(c){Object.keys(d[c]||{}).forEach(function(id){items.push({c:c,id:id,data:d[c][id]});});}); var n=items.length; putMany(items);
    if(d.settings){var st=Object.assign({},DEF_SET,d.settings); if(st.drivers&&st.drivers.length&&!Object.keys(d.drivers||{}).length){S.settings=st;migrate();} else {delete st.drivers; put('settings','center',st);}}
    render(); toast('기록 '+n+'건을 불러왔어요.');
  };
  r.readAsText(file);
}

/* ============ 6. 예시 기록 ============ */
function makeExamples(now){
  function back(n){return addDays(now,-n);}
  var vid='ex-v1', out={vehicles:{},trips:{},services:{},drivers:{},settings:{center:'별빛지역아동센터(예시)',approvers:'담당자/시설장',locks:[],emails:''}};
  out.drivers['ex-d1']={name:'김선생',edu:addMonths(now,-20),ts:1,ex:true};
  out.drivers['ex-d2']={name:'이선생',edu:back(716),ts:2,ex:true};
  out.vehicles[vid]={name:'노랑버스',plate:'12가 3456',baseOdo:61200,fuel:'경유',severe:false,inspDate:back(-24),insDate:back(-124),ts:1,ex:true};
  var sv=[['oil',246,52000,85000,'한빛카센터'],['cabin',387,47800,25000,'한빛카센터'],['rot',120,56000,20000,'한빛카센터'],['pad',660,30000,140000,'한빛카센터'],['batt',920,24000,160000,'한빛카센터'],['wiper',160,54500,30000,''],['bfluid',300,45000,60000,'한빛카센터'],['airf',246,52000,20000,'한빛카센터']];
  sv.forEach(function(s,i){out.services['ex-s'+i]={vid:vid,item:s[0],date:back(s[1]),km:s[2],cost:s[3],shop:s[4],ts:i,ex:true};});
  var km=61200, n=0, plan=[[9,'등원',14,9],[9,'하원',15,11],[8,'등원',14,8],[8,'하원',16,10],[7,'체험활동',46,12,'과학관'],[6,'등원',14,9],[6,'하원',15,9],[3,'등원',14,10],[3,'하원',15,11],[2,'등원',14,9],[2,'병원 동행',9,1,'소아과'],[2,'하원',15,10],[1,'등원',14,9],[1,'하원',16,11]];
  plan.forEach(function(p){out.trips['ex-t'+n]={vid:vid,date:back(p[0]),driver:n%3===2?'이선생':'김선생',purpose:p[1],dest:p[4]||'',startKm:km,endKm:km+p[2],startTime:p[1]==='등원'?'13:30':p[1]==='하원'?'18:00':'14:10',endTime:p[1]==='등원'?'14:05':p[1]==='하원'?'18:40':'16:30',riders:p[3],guardian:n%3===2?'김선생':'이선생',drvOk:true,guardOk:n!==13,checks:n===12?['tire','lamp','belt','door']:['tire','lamp','belt','door','sleep','off'],checkNote:n===4?'오른쪽 뒤 타이어 바람 보충':'',memo:'',ts:n,ex:true};km+=p[2];n++;});
  return out;
}
function addExamples(){var d=makeExamples(today()), items=[{c:'settings',id:'center',data:d.settings}]; COLLS.forEach(function(c){Object.keys(d[c]).forEach(function(id){items.push({c:c,id:id,data:d[c][id]});});}); putMany(items,function(ok,bad){ if(bad) toast('예시 '+bad+'건을 저장하지 못했어요. 화면을 새로 고쳐 다시 눌러 주세요.'); }); render();}
function clearExamples(){
  var items=[]; COLLS.forEach(function(c){Object.keys(S[c]).forEach(function(id){if(S[c][id].ex)items.push({c:c,id:id,data:null});});}); putMany(items);
  if(/\(예시\)/.test(S.settings.center||'')) put('settings','center',Object.assign({},S.settings,{center:''}));
  ui.vid=null; closeDlg(); toast('예시를 지웠어요. 우리 센터 차량을 등록해 주세요.');
}
function setLock(on){
  var st=Object.assign({},S.settings), locks=(st.locks||[]).filter(function(m){return m!==ui.month;}); if(on) locks.push(ui.month); st.locks=locks.sort();
  put('settings','center',st); closeDlg(); toast(on?'이 달을 마감했어요. 이제 고칠 수 없어요.':'마감을 풀었어요.');
}

/* ============ 7. 누르기 처리 ============ */
document.addEventListener('click',function(ev){
  document.querySelectorAll('details.menu[open]').forEach(function(m){ if(!m.contains(ev.target)||ev.target.closest('.menu-list [data-act]')) m.removeAttribute('open'); });
  var b=ev.target.closest('[data-act]'); if(!b) return; var act=b.dataset.act, v=b.dataset.v;
  switch(act){
    case 'tab': ui.tab=v; render(); window.scrollTo(0,0); break;
    case 'trip-like': (function(){var q=quickTemplates(curVid())[+v]; if(q) tripForm(null,q);})(); break;
    case 'row-mode': LS.set('cj.rowmode',!rowMode()); rowKeep=null; render(); break;
    case 'row-save': saveRow(); break;
    case 'exp-new': expForm(); break;
    case 'exp-save': saveExp(!!b.dataset.p); break;
    case 'rc-one': printReceipts([v]); break;
    case 'rc-blank': printReceipts(null); break;
    case 'claim': doClaim(); break;
    case 'fuel': doFuel(); break;
    case 'help': helpDlg(); break;
    case 'ampm': (function(){var id=b.dataset.tm; $(id+'_ap').value=v; syncTime(id); if($('dlg').dataset.trip) keepDraft(); if(b.closest('#entryRow')){ rowDirty=true; if(!rowOpenedAt) rowOpenedAt=Date.now(); } var n=$(id+'_box').querySelector('.next select'); if(n) n.focus();})(); break;
    case 'pin-eye': (function(){var i=$(v), show=i.type==='password'; i.type=show?'text':'password'; b.setAttribute('aria-pressed',show); b.setAttribute('aria-label',show?'암호 가리기':'암호 보이기'); b.innerHTML=EYE[show?1:0]; i.focus();})(); break;
    case 'help-print': printHelp(); break;
    case 'veh-pick': ui.vid=v; LS.set('cj.ui',{vid:v}); render(); break;
    case 'al-open': alertDlg(v); break;
    case 'bulk': bulkForm(); break;
    case 'bulk-save': saveBulk(); break;
    case 'trip-new': tripForm(); break;
    case 'trip-close': closeTrip(); break;
    case 'draft-drop': LS.set('cj.draft',null); render(); break;
    case 'draft-reset': LS.set('cj.draft',null); delete $('dlg').dataset.trip; tripForm(); break;
    case 'chk-all': CHECKS.forEach(function(c){$('tc_'+c.k).checked=true;}); keepDraft(); break;
    case 'season': seasonDlg(); break;
    case 'fb': fbForm(); break;
    case 'fb-save': saveFb(); break;
    case 'trip-edit': tripForm(v); break;
    case 'trip-save': saveTrip(v); break;
    case 'trip-del': confirmDlg('이 운행 기록을 지울까요? 지우면 되돌릴 수 없어요.','trip-del2',v); break;
    case 'trip-del2': delTrip(v); break;
    case 'svc-new': svcForm(v); break;
    case 'svc-save': saveSvc(v,!!b.dataset.p); break;
    case 'svc-del': confirmDlg('이 정비 기록을 지울까요? 다음 교환 시기가 다시 계산돼요.','svc-del2',v); break;
    case 'svc-del2': (function(){var old=S.services[v]; applyOp({c:'services',id:v,data:null}); send({c:'services',id:v,data:null,prev:old}); closeDlg(); toast('지웠어요.');})(); break;
    case 'veh-new': vehForm(); break;
    case 'veh-edit': vehForm(v||curVid()); break;
    case 'veh-save': saveVeh(v); break;
    case 'drv-new': drvForm(''); break;
    case 'drv-edit': drvForm(v); break;
    case 'drv-save': (function(){var name=$('dName').value.trim(); if(!name){$('dErr').innerHTML='<div class="err">이름을 적어 주세요.</div>';return;} var old=v?S.drivers[v]:{}; var d={name:name,edu:$('dEdu').value,ts:old.ts||Date.now()}; put('drivers',v||newId(),d); closeDlg(); toast('저장했어요.');})(); break;
    case 'drv-del': del('drivers',v); closeDlg(); toast('지웠어요.'); break;
    case 'set-save': (function(){var st=Object.assign({},S.settings); st.center=$('setCenter').value.trim(); st.approvers=$('setAppr').value.trim()||'담당자/시설장'; if($('setMail'))st.emails=$('setMail').value.trim(); put('settings','center',st); render(); toast('저장했어요.');})(); break;
    case 'me-save': me=$('setMe').value.trim(); LS.set('cj.me',me); toast('저장했어요.'); break;
    case 'iv-edit': ivForm(); break;
    case 'iv-save': (function(){var id=curVid(), nv=Object.assign({},S.vehicles[id]), o={}; itemsFor(nv).forEach(function(it){o[it.k]={km:numVal('ivk_'+it.k)||0,mo:numVal('ivm_'+it.k)||0};}); nv.intervals=o; nv.ivChecked=$('ivChk').checked; put('vehicles',id,nv); closeDlg(); toast('주기를 저장했어요.');})(); break;
    case 'iv-reset': (function(){var id=curVid(), nv=Object.assign({},S.vehicles[id]); delete nv.intervals; nv.ivChecked=false; put('vehicles',id,nv); closeDlg(); toast('기본 주기로 되돌렸어요.');})(); break;
    case 'month': (function(){var p=ui.month.split('-'), d=new Date(+p[0],+p[1]-1+(+v),1); ui.month=ymd(d).slice(0,7); if(cloud.watchMonth) cloud.watchMonth(ui.month); render();})(); break;
    case 'lock': confirmDlg('이 달 운행일지를 마감할까요? 마감하면 기록을 고치거나 지울 수 없어요. 결재를 받은 뒤에 눌러 주세요.','lock2','','네, 마감할게요'); break;
    case 'lock2': setLock(true); break;
    case 'unlock': confirmDlg('마감을 풀까요? 풀면 이 달 기록을 다시 고칠 수 있어요.','unlock2','','네, 풀게요'); break;
    case 'unlock2': setLock(false); break;
    case 'print': doPrint(); break;
    case 'csv': doCsv(); break;
    case 'svc-csv': doSvcCsv(); break;
    case 'hwpx': doHwpx(); break;
    case 'ics': doIcs(); break;
    case 'backup': doBackup(); break;
    case 'restore': $('restoreFile').value=''; $('restoreFile').click(); break;
    case 'ex-add': addExamples(); break;
    case 'ex-clear': confirmDlg('예시 기록을 모두 지우고 우리 센터 기록을 시작할까요?','ex-clear2'); break;
    case 'ex-clear2': clearExamples(); break;
    case 'dlg-close': closeDlg(); break;
    case 'pin-ok': window.pinFlow.ok(); break;
    case 'pin-new': window.pinFlow.make(); break;
    case 'pin-change': openDlg('<header><h2>센터 암호 바꾸기</h2><button type="button" class="btn sm" data-act="dlg-close">닫기</button></header><div class="body"><p class="muted">바꾸면 다른 선생님 기기에서도 새 암호를 다시 적어야 해요.</p><div class="field"><label for="pinNew">새 암호 (숫자 4자리 이상)</label>'+pinBox('pinNew')+'</div><div id="pinErr" role="alert"></div></div><footer><button type="button" class="btn" data-act="dlg-close">취소</button><button type="button" class="btn main" data-act="pin-change2">바꾸기</button></footer>'); break;
    case 'pin-change2': (function(){var p=$('pinNew').value.trim(); if(!/^\d{4,}$/.test(p)){$('pinErr').innerHTML='<div class="err">숫자 4자리 이상으로 적어 주세요.</div>';return;} gcall({op:'setPin',newPin:p}).then(function(){pin=p;LS.set('cj.pin',pin);closeDlg();toast('센터 암호를 바꿨어요.');},function(){$('pinErr').innerHTML='<div class="err">바꾸지 못했어요. 인터넷을 확인해 주세요.</div>';});})(); break;
    case 'chip': (function(){var f=b.dataset.f; $(f).value=v; if(f==='eKind'&&$('eLitBox')) $('eLitBox').hidden=(v!=='주유'); b.parentNode.querySelectorAll('.chip').forEach(function(c){c.setAttribute('aria-pressed',c===b);}); if($('dlg').dataset.trip) keepDraft();})(); break;
    case 'step': (function(){var n=(numVal('tRiders')||0)+(+v); $('tRiders').value=Math.max(0,n); keepDraft();})(); break;
  }
});
document.addEventListener('input',function(ev){
  if(ev.target.dataset&&ev.target.dataset.tm) syncTime(ev.target.dataset.tm);   // 시·분을 고르면 숨은 칸에 13:30처럼 넣는다 (먼저 해야 보관할 때 들어간다)
  if($('dlg').dataset.trip&&ev.target.closest('#tripBody')) keepDraft();
  if(ev.target.closest('#entryRow')){ rowDirty=true; if(!rowOpenedAt) rowOpenedAt=Date.now(); }
  if(ev.target.id==='tStart'||ev.target.id==='tEnd') updDist();
  if(ev.target.id==='tDriver'){ document.querySelectorAll('[data-f="tDriver"]').forEach(function(c){c.setAttribute('aria-pressed',c.dataset.v===ev.target.value);}); }
});
// 표에 바로 적기: Enter를 누르면 저장 (종이 일지처럼 한 줄 쓰고 다음 줄로)
document.addEventListener('keydown',function(ev){ if(ev.key==='Enter'&&ev.target.closest&&ev.target.closest('#entryRow')&&!ev.isComposing){ ev.preventDefault(); saveRow(); } });
// 오늘 화면의 점검 폴더를 펼쳤는지 기억한다
document.addEventListener('toggle',function(ev){ if(ev.target.id==='careFold') LS.set('cj.fold',ev.target.open); },true);
$('restoreFile').addEventListener('change',function(ev){ if(ev.target.files[0]) doRestore(ev.target.files[0]); });
$('dlg').addEventListener('cancel',function(ev){ev.preventDefault(); if($('dlg').dataset.trip) closeTrip(); else if(!$('pinIn')) closeDlg();});
// 운행 기록을 쓰다가 화면을 닫으려 하면 브라우저가 한 번 더 묻는다
window.addEventListener('beforeunload',function(ev){ if(tripDirty||rowDirty){ ev.preventDefault(); ev.returnValue=''; } });
$('dlg').addEventListener('submit',function(ev){ev.preventDefault();});
window.CJ={buildHwpx:buildHwpx,itemStatus:itemStatus,allAlerts:allAlerts,makeExamples:makeExamples,odoOf:odoOf,ITEMS:ITEMS,state:function(){return S;},outbox:function(){return outbox;}};
if(window.CC&&!window.CC_DISABLED){
  document.documentElement.classList.add('cc-dark-ok');
  CC.mountZoom($('zoomBtn')); CC.mountTheme($('themeBtn'));
  CC.init({ app:'chajikimi', appName:'차량지킴이', custom:true, chip:$('ccChip'), onEnter:centerEnter,
    onSignOut:function(){ LS.set('cj.outbox',[]); try{localStorage.removeItem('cj.center');}catch(e){} },
    keyLabel:function(k){ return ({trips:'운행 기록',services:'점검·정비 기록',vehicles:'차량',drivers:'운전자',settings:'설정'})[k.split('/')[0]]||k; } });
  var TOUR=[
    {title:'차량 지킴이에 오신 걸 환영해요',body:['차량 <b>점검 시기</b>를 한 화면에서 알려 주고 <b>운행일지</b>를 쉽게 적는 도구예요.','[다음]을 눌러 둘러보세요. (키보드 → 다음, Esc 닫기)']},
    {target:'#tabs',title:'네 개의 탭',body:['<b>오늘</b>: 운행 기록·바로 적기 · <b>운행일지</b>: 달마다 인쇄·마감 · <b>점검·정비</b>: 교환 기록·알림 · <b>설정</b>: 센터·운전자']},
    {target:'#view .btn.main, #view button',title:'매일 할 일은 하나',body:['운행을 마치면 <b>[오늘 운행 기록하기]</b>를 누르고 도착 km만 적으면 돼요.']},
    {target:'#ccChip',title:'어디에 저장되나요?',body:['지금은 <b>이 기기에만</b> 저장돼요.','누르면 <b>센터 계정</b>으로 바꿔 PC·휴대폰·다른 선생님과 함께 쓸 수 있어요.']},
    {target:'#zoomBtn',title:'글씨가 작으면',body:['누를 때마다 글자가 커져요.','자세한 설명은 <b>[사용 방법]</b>, 이 안내는 <b>[? 둘러보기]</b>로 다시 볼 수 있어요.']}
  ];
  $('tourBtn').addEventListener('click',function(){ ui.tab='home'; render(); CC.tour(TOUR,'cj',true); });
  if(!navigator.webdriver&&!window.TRIAL) setTimeout(function(){ CC.tour(TOUR,'cj'); },900);
} else { ['ccChip','zoomBtn','themeBtn','tourBtn'].forEach(function(id){ var e=$(id); if(e) e.hidden=true; }); }
setSync(); render(); boot();
