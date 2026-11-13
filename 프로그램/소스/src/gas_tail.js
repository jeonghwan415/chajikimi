
/* ============ 구글 시트 저장 (서버) ============ */
// 이 스크립트는 처음 실행될 때 '차량 지킴이 기록' 스프레드시트를 스스로 만든다.
// 각 시트는 [id, 사람이 읽는 칸들..., 원본(JSON)] 모양이다. 앱은 '원본' 칸만 읽는다.
var SHEET = { vehicles: '차량', trips: '운행일지', services: '정비기록', drivers: '운전자', settings: '설정', feedback: '의견' };
var COLS = {
  vehicles: [['name', '차 이름'], ['plate', '차량 번호'], ['fuel', '연료'], ['odo', '현재 km'], ['inspDate', '검사 만료일'], ['insDate', '보험 만기일']],
  trips: [['date', '일자'], ['startTime', '출발 시간'], ['endTime', '도착 시간'], ['purpose', '운행 목적'], ['dest', '목적지'], ['startKm', '출발 km'], ['endKm', '도착 km'], ['_dist', '운행 거리'], ['driver', '운전자'], ['drvOk', '운전자 확인'], ['guardian', '동승자'], ['guardOk', '동승자 확인'], ['_check', '차량 점검 내용'], ['riders', '탑승 아동'], ['memo', '메모'], ['by', '적은 사람'], ['secs', '작성 시간(초)']],
  services: [['date', '날짜'], ['item', '항목'], ['km', 'km'], ['cost', '비용'], ['shop', '정비소'], ['by', '적은 사람']],
  drivers: [['name', '이름'], ['edu', '안전교육일']],
  settings: [['center', '센터 이름'], ['approvers', '결재란'], ['emails', '알림 메일']],
  feedback: [['at', '보낸 때'], ['by', '이름'], ['ease', '쉬움(1~5)'], ['oldTime', '지금 방식 1건 시간'], ['confusing', '헷갈린 것'], ['good', '좋았던 점'], ['wish', '바라는 점'], ['device', '기기'], ['trips', '적은 운행 수'], ['avgSecs', '평균 작성 시간(초)']]
};
var PROPS = PropertiesService.getScriptProperties();

function doGet() {
  return HtmlService.createHtmlOutput(PAGE).setTitle('차량 지킴이')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ss_() {
  var id = PROPS.getProperty('SSID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ } }
  var ss = SpreadsheetApp.create('차량 지킴이 기록');
  PROPS.setProperty('SSID', ss.getId());
  return ss;
}

function sheet_(coll) {
  var ss = ss_(), name = coll === 'history' ? '변경이력' : SHEET[coll], sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(coll === 'history' ? ['때', '누가', '종류', 'id', '한 일', '바꾸기 전(원본)']
      : ['id'].concat(COLS[coll].map(function (c) { return c[1]; })).concat(['원본(고치지 마세요)']));
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowOf_(coll, id, obj) {
  return [id].concat(COLS[coll].map(function (c) {
    var v = obj[c[0]];
    if (c[0] === '_dist') return (+obj.endKm || 0) - (+obj.startKm || 0);
    if (c[0] === '_check') return checkText(obj);
    if (coll === 'services' && c[0] === 'item') { // 사람이 읽는 이름으로 (예: oil → 엔진오일·오일필터)
      if (obj.itemName) return obj.itemName;
      for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].k === v) return ITEMS[i].full;
    }
    if (v === true) return '확인';
    if (v === false) return '';
    return v == null ? '' : v;
  })).concat([JSON.stringify(obj)]);
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function readAll_() {
  var out = { vehicles: {}, trips: {}, services: {}, drivers: {}, settings: {} };
  Object.keys(SHEET).forEach(function (coll) {
    if (coll === 'feedback') return; // 의견은 화면으로 돌려보내지 않는다 (시트에서만 본다)
    var sh = sheet_(coll), last = sh.getLastRow();
    if (last < 2) return;
    var width = COLS[coll].length + 2;
    sh.getRange(2, 1, last - 1, width).getValues().forEach(function (r) {
      if (!r[0]) return;
      try {
        var obj = JSON.parse(r[width - 1]);
        if (coll === 'settings') out.settings = obj; else out[coll][String(r[0])] = obj;
      } catch (e) { /* 원본 칸이 깨진 줄은 건너뛴다 */ }
    });
  });
  return out;
}

/* ---- 센터 암호: 로그인 대신 쓴다. 암호 자체는 저장하지 않고 변환한 값만 저장한다. ---- */
function hash_(pin) {
  var salt = PROPS.getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); PROPS.setProperty('SALT', salt); }
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8));
}
// 10번 틀리면 10분 동안 잠근다 (암호를 마구 넣어 보는 것을 막는다)
function checkPin_(pin) {
  var until = +PROPS.getProperty('LOCK_UNTIL') || 0;
  if (Date.now() < until) return 'lock';
  if (hash_(String(pin || '')) === PROPS.getProperty('PIN')) { if (PROPS.getProperty('FAILS')) PROPS.deleteProperty('FAILS'); return ''; }
  var fails = (+PROPS.getProperty('FAILS') || 0) + 1;
  if (fails >= 10) { PROPS.setProperty('LOCK_UNTIL', String(Date.now() + 600000)); PROPS.deleteProperty('FAILS'); } else PROPS.setProperty('FAILS', String(fails));
  return 'pin';
}

function lockedMonth_(settings, date) { return ((settings || {}).locks || []).indexOf(String(date || '').slice(0, 7)) >= 0; }

// 설정(마감한 달)만 빠르게 읽는다
function settings_() {
  var sh = sheet_('settings'), last = sh.getLastRow(), width = COLS.settings.length + 2;
  if (last < 2) return {};
  try { return JSON.parse(sh.getRange(2, width).getValue()); } catch (e) { return {}; }
}

// 한 건 쓰기 (잠금은 부르는 쪽에서 건다)
function writeOne_(req, settings) {
  var coll = req.c, id = req.id;
  if (!COLS[coll]) return { ok: false, err: 'bad', msg: '알 수 없는 종류예요.' };
  var sh = sheet_(coll), row = findRow_(sh, id), width = COLS[coll].length + 2, before = '';
  if (row > 0) before = String(sh.getRange(row, width).getValue());
  if (coll === 'trips') { // 마감한 달의 운행은 서버에서도 막는다
    var oldDate = '';
    try { oldDate = before ? JSON.parse(before).date : ''; } catch (e) { }
    if ((oldDate && lockedMonth_(settings, oldDate)) || (req.data && lockedMonth_(settings, req.data.date)))
      return { ok: false, err: 'locked', msg: '마감한 달이에요. 마감을 푼 뒤에 고칠 수 있어요.' };
  }
  if (req.op === 'put') {
    var values = [rowOf_(coll, id, req.data)];
    sh.getRange(row > 0 ? row : sh.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
  } else if (row > 0) sh.deleteRow(row);
  if (coll === 'trips' || coll === 'services' || (coll === 'settings' && before)) // 수정 이력
    sheet_('history').appendRow([new Date(), req.by || '', SHEET[coll], id, req.op === 'del' ? '삭제' : (before ? '수정' : '추가'), before]);
  return { ok: true, data: true };
}

function write_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return writeOne_(req, settings_()); } finally { lock.releaseLock(); }
}

// 여러 건을 한 번에 쓴다 (예시 넣기, 백업 불러오기). 하나씩 보내면 동시에 몰려 실패할 수 있다.
function writeMany_(req) {
  var lock = LockService.getScriptLock(), done = 0, failed = [];
  lock.waitLock(25000);
  try {
    var settings = settings_();
    (req.items || []).forEach(function (it) {
      var r = writeOne_({ op: it.data ? 'put' : 'del', c: it.c, id: it.id, data: it.data, by: req.by }, settings);
      if (r.ok) { done++; if (it.c === 'settings' && it.data) settings = it.data; } else failed.push(it.id);
    });
  } finally { lock.releaseLock(); }
  return { ok: true, data: { done: done, failed: failed } };
}

// 웹앱이 부르는 함수는 이것 하나다. 주고받는 값은 JSON 문자열이다.
function api(json) {
  var req = JSON.parse(json), hasPin = !!PROPS.getProperty('PIN'), res;
  if (req.op === 'status') res = { ok: true, data: { hasPin: hasPin } };
  else if (req.op === 'setPin' && !hasPin) {
    if (!/^\d{4,}$/.test(String(req.newPin))) res = { ok: false, err: 'bad', msg: '숫자 4자리 이상이어야 해요.' };
    else { PROPS.setProperty('PIN', hash_(String(req.newPin))); res = { ok: true, data: true }; }
  } else {
    var bad = hasPin ? checkPin_(req.pin) : 'pin';
    if (bad) res = { ok: false, err: bad };
    else if (req.op === 'getAll') res = { ok: true, data: readAll_() };
    else if (req.op === 'put' || req.op === 'del') res = write_(req);
    else if (req.op === 'putMany') res = writeMany_(req);
    else if (req.op === 'setPin') {
      if (!/^\d{4,}$/.test(String(req.newPin))) res = { ok: false, err: 'bad' };
      else { PROPS.setProperty('PIN', hash_(String(req.newPin))); res = { ok: true, data: true }; }
    } else res = { ok: false, err: 'bad' };
  }
  return JSON.stringify(res);
}

/* ============ 매주 월요일 아침 점검 알림 메일 ============ */
// 지났거나 곧 돌아오는 항목만 모아 메일 본문을 만든다. 화면과 같은 규칙(allAlerts)을 쓴다.
function reminderText_(S, now) {
  var lines = [];
  Object.keys(S.vehicles).forEach(function (vid) {
    var due = allAlerts(S, vid, now).filter(function (a) { return a.st === 'over' || a.st === 'soon'; });
    if (!due.length) return;
    lines.push('■ ' + S.vehicles[vid].name + ' (지금 ' + fmtKm(odoOf(S, vid)) + 'km)');
    due.forEach(function (a) {
      lines.push('  ' + (a.st === 'over' ? '[지났어요] ' : '[곧 챙기기] ') + a.full + ' : ' + a.label);
      lines.push('     근거: ' + a.why);
    });
    lines.push('');
  });
  if (lines.length) { var s = seasonOf(now); lines.push('● ' + s.name + ' 관리: ' + s.line); s.items.forEach(function (x) { lines.push('  - ' + x); }); }
  return lines.join('\n');
}

function sendReminder() {
  var S = readAll_(), body = reminderText_(S, today());
  if (!body) return; // 챙길 것이 없으면 보내지 않는다
  var to = [Session.getEffectiveUser().getEmail()].concat(String((S.settings || {}).emails || '').split(/[,\s]+/))
    .filter(function (x, i, a) { return /@/.test(x) && a.indexOf(x) === i; });
  MailApp.sendEmail(to.join(','), '[차량 지킴이] 이번 주 챙길 차량 점검', body + '\n자세한 내용은 차량 지킴이 화면에서 확인하세요.');
}

// 한 번만 실행하면 매주 월요일 오전 8시대에 sendReminder가 돈다. 기록 시트도 이때 만들어진다.
function installWeeklyReminder() {
  ss_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
}

// 기록이 들어 있는 스프레드시트 주소를 알려 준다 (실행 기록에 나온다)
function whereIsMySheet() { Logger.log(ss_().getUrl()); return ss_().getUrl(); }
