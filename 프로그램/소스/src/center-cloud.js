/* =====================================================================
   센터 계정(B) 공통 모듈 — center-cloud v1.1 (2026-11-24)
   프로그램 서포터 · 6대 의무교육 도우미 · 차량 지킴이가 똑같은 코드를 씁니다. 고칠 때는 세 곳을 같이 고쳐요.
   - 서버: Supabase (주소·공개 키는 CENTER_CLOUD_CONFIG 또는 [센터 계정 → 서버 연결]에서 넣음)
   - 서버 정보가 없거나 로그인하지 않으면 지금처럼 '이 컴퓨터에만 저장'(A)으로 동작
   - 로그인 + 센터 선택 → 이 프로그램의 기록을 센터 서버와 맞춤 (20초마다, 창으로 돌아올 때, 고친 뒤 1초 뒤)
   - 같은 기록을 두 곳에서 동시에 고치면 이 컴퓨터에서 고친 내용이 남고, 서버에 변경 기록이 남음
   - 아동 사진(IndexedDB)·AI 키·화면 설정은 서버에 보내지 않음
   - 라이브러리 없이 fetch만 씀 (외부 파일을 불러오지 않음)
   - v1.1: 서버 연결 전에는 [내 기록은 어디에?] 안내 창(개인정보 안내·백업·이 컴퓨터 기록 모두 지우기)이 먼저 나옴
     CC.init에 wipe:{prefixes:[…], idb:[…]}, backup:함수, privacyNote:'문장' 을 넘겨요
   ===================================================================== */
(function () {
  "use strict";
  if (window.CC) return;
  var CC = window.CC = { version: "1.0" };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { CC._quiet++; localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } finally { CC._quiet--; } },
    del: function (k) { try { CC._quiet++; localStorage.removeItem(k); } catch (e) {} finally { CC._quiet--; } }
  };
  CC._quiet = 0;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- 1) 서버 정보 ---------- */
  CC.config = function () {
    var d = window.CENTER_CLOUD_CONFIG || {}, c = LS.get("cc.config", {}) || {};
    return { url: String(c.url || d.url || "").trim().replace(/\/+$/, ""), key: String(c.key || d.anonKey || "").trim(), fromCode: !c.url && !!d.url };
  };
  var URL_OK = /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
  CC.configured = function () { var c = CC.config(); return URL_OK.test(c.url) && c.key.length > 20; };

  /* ---------- 2) 메일 링크로 돌아왔을 때 (#access_token=…) — 프로그램이 주소를 읽기 전에 처리 ---------- */
  var linkType = null, linkError = null;
  (function readHash() {
    var h = location.hash || "";
    if (!/(^#|&)(access_token|error_description)=/.test(h)) return;
    var p = {}; h.slice(1).split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
    if (p.access_token && p.refresh_token) {
      LS.set("cc.session", { access_token: p.access_token, refresh_token: p.refresh_token, expires_at: Date.now() + (Number(p.expires_in) || 3600) * 1000 - 60000, user: tokenUser(p.access_token) });
      linkType = p.type || "signup";
    } else if (p.error_description) linkError = p.error_description;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
  })();
  function tokenUser(t) {
    try { var b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); var j = JSON.parse(decodeURIComponent(escape(atob(b)))); return { id: j.sub, email: j.email || "" }; } catch (e) { return { id: "", email: "" }; }
  }

  /* ---------- 3) 서버와 주고받기 ---------- */
  var KO = [
    [/invalid login credentials/i, "이메일이나 비밀번호가 맞지 않아요."],
    [/email not confirmed/i, "메일함에서 가입 확인 링크를 먼저 눌러 주세요."],
    [/already registered|already been registered|user already exists/i, "이미 가입한 이메일이에요. [로그인]에서 들어와 주세요."],
    [/password should be at least|weak password/i, "비밀번호는 8자 이상으로, 숫자와 글자를 섞어 주세요."],
    [/rate limit|too many|security purposes/i, "잠깐 사이에 여러 번 시도했어요. 1~2분 뒤에 다시 해 주세요."],
    [/unable to validate email|invalid format|email address.*invalid/i, "이메일 주소를 다시 확인해 주세요."],
    [/signups not allowed|signup is disabled/i, "지금은 새로 가입할 수 없게 설정돼 있어요. 관리자에게 물어보세요."],
    [/jwt expired|invalid jwt|not authorized|permission denied/i, "로그인이 풀렸어요. 다시 로그인해 주세요."],
    [/check constraint|violates/i, "적은 내용이 너무 길거나 맞지 않아요."],
    [/failed to fetch|networkerror|load failed/i, "인터넷 연결을 확인해 주세요."]
  ];
  function koMsg(j, status) {
    var m = j && (j.msg || j.message || j.error_description || j.error) || "";
    if (/[가-힣]/.test(m)) return m;
    for (var i = 0; i < KO.length; i++) if (KO[i][0].test(m)) return KO[i][1];
    if (status === 429) return KO[4][1];
    if (status >= 500) return "서버가 잠시 답하지 않아요. 조금 뒤에 다시 해 주세요.";
    return "처리하지 못했어요." + (m ? " (" + m + ")" : "");
  }
  var refreshing = null;
  function session() { return LS.get("cc.session", null); }
  function refreshSession() {
    var s = session(); if (!s || !s.refresh_token) return Promise.reject({ auth: true, msg: "로그인이 필요해요." });
    if (refreshing) return refreshing;
    refreshing = http("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token }, auth: false })
      .then(function (j) { saveSession(j); return j; }, function (e) { if (!e.retry) { LS.del("cc.session"); emit(); } throw e; })
      .then(function (j) { refreshing = null; return j; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function saveSession(j) {
    LS.set("cc.session", { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000, user: j.user ? { id: j.user.id, email: j.user.email } : tokenUser(j.access_token) });
  }
  function http(path, o) {
    o = o || {};
    var c = CC.config();
    if (!CC.configured()) return Promise.reject({ msg: "서버 연결 정보가 없어요." });
    var pre = Promise.resolve();
    if (o.auth !== false) {
      var s = session();
      if (!s) return Promise.reject({ auth: true, msg: "로그인이 필요해요." });
      if (Date.now() > s.expires_at) pre = refreshSession();
    }
    return pre.then(function () {
      var s = session(), h = { apikey: c.key, "Content-Type": "application/json" };
      h.Authorization = "Bearer " + (o.auth !== false && s ? s.access_token : c.key);
      if (o.prefer) h.Prefer = o.prefer;
      return fetch(c.url + path, { method: o.method || "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body), cache: "no-store" })
        .catch(function () { throw { retry: true, offline: true, msg: "인터넷 연결을 확인해 주세요." }; });
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.status === 401 && o.auth !== false && !o.again) return refreshSession().then(function () { o.again = true; return http(path, o); });
        if (!r.ok) throw { status: r.status, retry: r.status >= 500 || r.status === 429, auth: r.status === 401, msg: koMsg(j, r.status) };
        return j;
      });
    });
  }
  CC.rpc = function (fn, args) { return http("/rest/v1/rpc/" + fn, { method: "POST", body: args || {} }); };
  function redirectTo() { return /^https?:/.test(location.protocol) ? "?redirect_to=" + encodeURIComponent(location.origin + location.pathname) : ""; }

  /* ---------- 4) 로그인 ---------- */
  var fails = LS.get("cc.fails", { n: 0, at: 0 });
  CC.user = function () { var s = session(); return s && s.user; };
  CC.signIn = function (email, pw) {
    if (fails.n >= 5 && Date.now() - fails.at < 5 * 60000) return Promise.reject({ msg: "여러 번 틀려서 5분 동안 잠겼어요. 잠시 뒤에 다시 해 주세요." });
    return http("/auth/v1/token?grant_type=password", { method: "POST", body: { email: email, password: pw }, auth: false })
      .then(function (j) { fails = { n: 0, at: 0 }; LS.set("cc.fails", fails); saveSession(j); emit(); return j; },
        function (e) { if (e.status === 400) { fails = { n: (Date.now() - fails.at > 5 * 60000 ? 0 : fails.n) + 1, at: Date.now() }; LS.set("cc.fails", fails); } throw e; });
  };
  CC.signUp = function (email, pw) {
    return http("/auth/v1/signup" + redirectTo(), { method: "POST", body: { email: email, password: pw }, auth: false })
      .then(function (j) { if (j && j.access_token) { saveSession(j); emit(); return { session: true }; } return { needConfirm: true }; });
  };
  CC.recover = function (email) { return http("/auth/v1/recover" + redirectTo(), { method: "POST", body: { email: email }, auth: false }); };
  CC.setPassword = function (pw) { return http("/auth/v1/user", { method: "PUT", body: { password: pw } }); };

  /* ---------- 5) 센터 ---------- */
  CC.center = function () { var c = LS.get("cc.center", null), u = CC.user(); return c && u && c.uid === u.id ? c : null; };
  function setCenter(c) { var u = CC.user(); if (c) { c.uid = u && u.id; LS.set("cc.center", c); } else LS.del("cc.center"); emit(); }
  CC.myCenters = function () { return CC.rpc("my_centers"); };
  CC.createCenter = function (name, me, ack) { return CC.rpc("create_center", { p_name: name, p_display_name: me, p_privacy_ack: !!ack }).then(function (r) { setCenter(r[0]); return r[0]; }); };
  CC.joinCenter = function (code, me) { return CC.rpc("join_center", { p_code: code, p_display_name: me }).then(function (r) { setCenter(r[0]); return r[0]; }); };
  CC.isCenter = function () { return CC.configured() && !!CC.user() && !!CC.center(); };

  /* ---------- 6) 기록 맞추기 (공통 저장 칸 방식) ---------- */
  CC.pull = function (app, since) {
    var c = CC.center(), out = [];
    function page(off) {
      return http("/rest/v1/center_data?select=key,value,updated_at,updated_by,updated_name&center_id=eq." + c.id + "&app=eq." + encodeURIComponent(app) +
        (since ? "&updated_at=gt." + encodeURIComponent(since) : "") + "&order=updated_at.asc,key.asc&limit=500&offset=" + off)
        .then(function (rows) { out = out.concat(rows || []); return rows && rows.length === 500 ? page(off + 500) : out; });
    }
    return page(0);
  };
  CC.push = function (app, rows) {
    var c = CC.center(), batches = [], cur = [], size = 0;
    rows.forEach(function (r) { var n = JSON.stringify(r.value).length; if (cur.length && (size + n > 900000 || cur.length >= 200)) { batches.push(cur); cur = []; size = 0; } cur.push({ center_id: c.id, app: app, key: r.key, value: r.value }); size += n; });
    if (cur.length) batches.push(cur);
    return batches.reduce(function (p, b) {
      return p.then(function () { return http("/rest/v1/center_data?on_conflict=center_id,app,key", { method: "POST", body: b, prefer: "resolution=merge-duplicates,return=minimal" }); });
    }, Promise.resolve());
  };
  // 키 순서와 상관없이 같은 내용이면 같은 값
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  function hash(v) {
    if (v === null || v === undefined) return "-";
    var s = canon(v), h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) { var ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + "." + s.length;
  }
  CC.hash = hash;
  // 사진·첨부 파일(data: 주소)은 서버로 보내지 않음 — 찍은 컴퓨터에만 남김
  CC.stripDataUrls = function strip(v) {
    if (typeof v === "string") return /^data:/.test(v) && v.length > 200 ? "" : v;
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = strip(v[k]); }); return o; }
    return v;
  };

  var spec = null, st = null, timers = { push: 0, pull: 0 }, busy = false, again = false;
  var status = { state: "local", pending: 0, last: 0, msg: "" };
  function stKey() { return "cc.sync." + spec.app; }
  function rawGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function keySpec(rk) { for (var i = 0; i < spec.keys.length; i++) { var s = spec.keys[i]; if (rk === s.k || (s.map && rk.indexOf(s.k + "/") === 0)) return s; } return null; }
  // 지금 이 컴퓨터에 있는 기록을 행(rowKey → 값)으로 펼침
  function localRows() {
    var out = {};
    spec.keys.forEach(function (s) {
      var v = rawGet(s.k); if (v == null) return;
      if (spec.clean) v = spec.clean(s.k, v);
      if (s.map === "object" && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach(function (id) { out[s.k + "/" + id] = v[id]; });
      else if (s.map === "array" && Array.isArray(v)) v.forEach(function (it) { if (it && it[s.id || "id"] != null) out[s.k + "/" + it[s.id || "id"]] = it; });
      else if (!s.map) out[s.k] = v;
    });
    return out;
  }
  function diff() {
    var L = localRows(), ch = [];
    Object.keys(L).forEach(function (rk) { if (st.sh[rk] !== hash(L[rk])) ch.push({ key: rk, value: L[rk] }); });
    Object.keys(st.sh).forEach(function (rk) { if (!(rk in L) && st.sh[rk] !== "-") ch.push({ key: rk, value: null }); });
    return ch;
  }
  // 서버에서 온 행을 이 컴퓨터 저장 칸에 넣음
  function applyRows(rows) {
    var L = localRows(), byKey = {}, changed = {}, conflicts = 0, uid = (CC.user() || {}).id;
    rows.forEach(function (r) {
      var s = keySpec(r.key); if (!s) return;
      if (s.map && !/^[\w.:-]{1,100}$/.test(r.key.slice(s.k.length + 1))) return;   // 이상한 id는 받지 않음 (화면에 그대로 쓰이는 곳이 있어서)
      if (s.map === "array" && r.value != null && String(r.value[s.id || "id"]) !== r.key.slice(s.k.length + 1)) return;
      var rh = hash(r.value), lh = r.key in L ? hash(L[r.key]) : "-", sh = st.sh[r.key];
      if (lh === rh) { st.sh[r.key] = rh; return; }
      var localEdited = sh === undefined ? (lh !== "-" && !!s.map) : lh !== sh;   // 처음 맞출 때: 목록 칸은 합치고, 한 칸짜리는 센터 것을 씀
      if (localEdited) { if (sh !== undefined && r.updated_by !== uid) conflicts++; return; }   // 이 컴퓨터에서 고친 것이 남음(곧 보냄)
      (byKey[s.k] = byKey[s.k] || []).push(r); st.sh[r.key] = rh;
    });
    Object.keys(byKey).forEach(function (k) {
      var s = keySpec(k), v = rawGet(k), list = byKey[k];
      if (!s.map) { v = list[list.length - 1].value; }
      else if (s.map === "object") { v = v && typeof v === "object" ? v : {}; list.forEach(function (r) { var id = r.key.slice(k.length + 1); if (r.value == null) delete v[id]; else v[id] = r.value; }); }
      else { v = Array.isArray(v) ? v : []; var idf = s.id || "id"; list.forEach(function (r) { var id = r.key.slice(k.length + 1), i = v.findIndex(function (it) { return it && String(it[idf]) === id; }); if (r.value == null) { if (i >= 0) v.splice(i, 1); } else if (i >= 0) v[i] = r.value; else v.push(r.value); }); }
      if (v == null) LS.del(k); else LS.set(k, v);
      changed[k] = true;
    });
    var who = {}; rows.forEach(function (r) { if (r.updated_by && r.updated_by !== uid && r.updated_name) who[r.updated_name] = 1; });
    return { keys: Object.keys(changed), conflicts: conflicts, who: Object.keys(who) };
  }
  function saveSt() { LS.set(stKey(), st); }
  function setStatus(s, msg) { status.state = s; status.msg = msg || ""; emit(); }
  CC.status = function () { return status; };

  function syncNow(opts) {
    opts = opts || {};
    if (!spec || spec.custom || !st || !CC.isCenter()) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true;
    var ch = diff();
    status.pending = ch.length;
    var p = ch.length ? CC.push(spec.app, ch).then(function () { ch.forEach(function (r) { st.sh[r.key] = hash(r.value); }); saveSt(); }) : Promise.resolve();
    var since = st.since ? new Date(new Date(st.since).getTime() - 3000).toISOString() : null;
    return p.then(function () { return CC.pull(spec.app, since); }).then(function (rows) {
      var res = applyRows(rows);
      rows.forEach(function (r) { if (!st.since || r.updated_at > st.since) st.since = r.updated_at; });
      saveSt();
      status.pending = diff().length; status.last = Date.now();
      busy = false; setStatus(status.pending ? "pending" : "ok");
      if (res.keys.length && spec.onRemote) { try { spec.onRemote(res.keys, res.who); } catch (e) { console.warn(e); } }
      if (res.conflicts) CC.toast("같은 기록을 다른 곳에서도 고쳤어요. 이 컴퓨터에서 고친 내용으로 맞췄어요.");
      if (status.pending) schedulePush(3000);
      if (again) { again = false; return syncNow(); }
    }, function (e) {
      busy = false; again = false;
      if (e && e.auth) { setStatus("error", "로그인이 풀렸어요"); }
      else setStatus(e && e.offline ? "offline" : "error", e && e.msg);
      if (opts.loud) CC.toast((e && e.msg) || "맞추지 못했어요.");
    });
  }
  CC.syncNow = syncNow;
  function schedulePush(ms) { clearTimeout(timers.push); timers.push = setTimeout(syncNow, ms == null ? 1200 : ms); }
  function tracked(k) { return spec && !spec.custom && spec.keys.some(function (s) { return s.k === k; }); }
  // 프로그램이 localStorage에 쓸 때마다 알아채서 잠시 뒤 서버로 보냄
  (function hook() {
    var P = Storage.prototype, set = P.setItem, rem = P.removeItem;
    P.setItem = function (k, v) { set.call(this, k, v); if (this === window.localStorage && !CC._quiet && tracked(k) && CC.isCenter()) { status.pending = Math.max(1, status.pending); setStatus("pending"); schedulePush(); } };
    P.removeItem = function (k) { rem.call(this, k); if (this === window.localStorage && !CC._quiet && tracked(k) && CC.isCenter()) schedulePush(); };
  })();
  function localCount() { return Object.keys(localRows()).length; }
  function backupFile() {
    var o = { app: spec.app, savedAt: new Date().toISOString(), note: "센터 계정으로 바꾸기 전 이 컴퓨터 기록", data: {} };
    spec.keys.forEach(function (s) { var v = localStorage.getItem(s.k); if (v != null) o.data[s.k] = v; });
    var a = document.createElement("a"), d = new Date();
    a.href = URL.createObjectURL(new Blob([JSON.stringify(o)], { type: "application/json" }));
    a.download = spec.appName + "_이컴퓨터기록_" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function clearLocal() { spec.keys.forEach(function (s) { LS.del(s.k); }); }
  // 센터에 처음 들어올 때: 이 컴퓨터 기록을 올릴지 묻기
  function firstSync() {
    var c = CC.center();
    if (st && st.center === c.id) return syncNow();
    var n = localCount();
    st = { center: c.id, since: null, sh: {} };
    var pullFirst = function () {   // 센터 것을 먼저 받아 두고(한 칸짜리 설정은 센터 것), 그다음 이 컴퓨터에만 있는 것을 보냄
      return CC.pull(spec.app, null).then(function (rows) {
        applyRows(rows); rows.forEach(function (r) { if (!st.since || r.updated_at > st.since) st.since = r.updated_at; }); saveSt();
      }).then(function () { return syncNow({ loud: true }); }, function (e) {
        st = null; LS.del(stKey()); CC.toast(((e && e.msg) || "센터 기록을 받지 못했어요.") + " 잠시 뒤 다시 열어 주세요.");
        throw e;
      });
    };
    if (!n) { saveSt(); return pullFirst().then(function () { reloadSoon(); }); }
    return ask("이 컴퓨터에 있던 기록", "<p>이 컴퓨터에 <b>" + esc(spec.countText ? spec.countText(n) : n + "건") + "</b>의 기록이 있어요. <b>" + esc(c.name) + "</b> 기록에 합칠까요?</p>" +
      "<ul class='cc-list'><li><b>합치기</b>: 이 기록도 센터 선생님들이 함께 봐요.</li><li><b>합치지 않기</b>: 이 기록은 파일로 받아 두고, 이 컴퓨터에는 센터 기록만 보여요.</li></ul>",
      [{ t: "합치기", v: "merge", main: true }, { t: "합치지 않기 (파일로 받기)", v: "keep" }]).then(function (v) {
      if (v == null) { st = null; setCenter(null); CC.toast("센터에 들어가지 않았어요. 지금처럼 이 컴퓨터에만 저장돼요."); return; }
      if (v !== "merge") { backupFile(); clearLocal(); }
      saveSt();
      return pullFirst().then(function () { CC.toast(v === "merge" ? "이 컴퓨터 기록을 센터에 합쳤어요." : "이 컴퓨터 기록을 파일로 받아 두었어요."); reloadSoon(); });
    });
  }
  function reloadSoon() { if (spec.reloadOnEnter !== false) setTimeout(function () { location.reload(); }, 600); }
  function startLoops() {
    clearInterval(timers.pull); timers.pull = setInterval(function () { if (!document.hidden) syncNow(); }, 20000);
    window.addEventListener("focus", function () { syncNow(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) syncNow(); });
    window.addEventListener("online", function () { syncNow(); });
    window.addEventListener("pagehide", function () { if (diff().length) syncNow(); });
  }
  CC.signOut = function () {
    var pend = spec && !spec.custom && st && CC.isCenter() ? diff().length : 0;
    var go = function () {
      var s = session();
      if (s) http("/auth/v1/logout", { method: "POST" }).catch(function () {});
      if (spec && !spec.custom) { clearLocal(); LS.del(stKey()); }
      if (spec && spec.onSignOut) spec.onSignOut();
      LS.del("cc.session"); LS.del("cc.center"); emit();
      setTimeout(function () { location.reload(); }, 300);
    };
    if (!pend) return Promise.resolve(go());
    return ask("아직 보내지 못한 기록", "<p>서버로 아직 보내지 못한 기록이 <b>" + pend + "건</b> 있어요. 인터넷을 확인하고 [다시 보내기]를 눌러 주세요. 그래도 로그아웃하면 이 기록은 사라져요.</p>",
      [{ t: "다시 보내기", v: "retry", main: true }, { t: "그래도 로그아웃", v: "out", danger: true }]).then(function (v) {
      if (v === "out") go(); else syncNow({ loud: true });
    });
  };

  /* ---------- 7) 화면: 상태 단추 · 창 · 알림 ---------- */
  var listeners = [];
  CC.on = function (fn) { listeners.push(fn); };
  function emit() { listeners.forEach(function (f) { try { f(status); } catch (e) {} }); paintChips(); }
  var chips = [];
  CC.mountChip = function (el) { if (!el) return; chips.push(el); el.classList.add("cc-chip"); el.type = "button"; el.addEventListener("click", function () { CC.open(); }); paintChips(); };
  function paintChips() {
    var c = CC.center(), t, cls;
    if (!CC.isCenter()) { t = "이 컴퓨터에만 저장"; cls = "local"; }
    else if (status.state === "offline") { t = c.name + " · 연결 끊김"; cls = "warn"; }
    else if (status.state === "error") { t = c.name + " · 확인 필요"; cls = "warn"; }
    else if (status.state === "pending") { t = c.name + " · 보내는 중"; cls = "on"; }
    else { t = c.name + " · 함께 저장"; cls = "on"; }
    chips.forEach(function (el) {
      el.dataset.cc = cls;
      el.innerHTML = '<span class="cc-dot" aria-hidden="true"></span><span class="cc-t">' + esc(t) + "</span>";
      el.title = CC.isCenter() ? "센터 계정: " + c.name + " (" + (CC.user() || {}).email + ")" : "지금은 이 컴퓨터에만 저장돼요. 눌러서 센터 계정으로 바꿀 수 있어요.";
      el.setAttribute("aria-label", "센터 계정 — " + t);
    });
  }
  var toastT = 0;
  CC.toast = function (msg) {
    var el = $("ccToast");
    if (!el) { el = document.createElement("div"); el.id = "ccToast"; el.className = "cc-toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 4200);
  };
  var dlg = null, dlgDone = null;
  function openDlg(title, body, foot) {
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.className = "cc-dlg"; dlg.setAttribute("aria-labelledby", "ccDlgT");
      document.body.appendChild(dlg);
      dlg.addEventListener("close", function () { if (dlg.open) return; if (dlgDone) { var f = dlgDone; dlgDone = null; f(null); } });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    }
    dlg.innerHTML = '<form method="dialog" class="cc-box" novalidate><header><h2 id="ccDlgT">' + esc(title) + '</h2><button class="cc-x" value="" aria-label="닫기" formnovalidate>✕</button></header><div class="cc-body">' + body + '</div>' + (foot ? '<footer>' + foot + "</footer>" : "") + "</form>";
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
    var f = dlg.querySelector("input:not([type=checkbox]):not([readonly]),button.cc-main"); if (f) f.focus();
    return dlg;
  }
  function closeDlg() { if (dlg && dlg.open) dlg.close(); }
  function ask(title, html, btns) {
    return new Promise(function (res) {
      var d = openDlg(title, html, btns.map(function (b) { return '<button type="button" class="cc-btn' + (b.main ? " cc-main" : "") + (b.danger ? " cc-danger" : "") + '" data-v="' + esc(b.v) + '">' + esc(b.t) + "</button>"; }).join(""));
      dlgDone = res;
      d.querySelectorAll("footer [data-v]").forEach(function (b) { b.onclick = function () { dlgDone = null; closeDlg(); res(b.dataset.v); }; });
    });
  }
  CC.ask = ask;
  function errBox(id, e) { var el = $(id); if (el) { el.innerHTML = '<p class="cc-err">' + esc((e && e.msg) || e || "처리하지 못했어요.") + "</p>"; } }
  function busyBtn(b, on, label) { if (!b) return; if (on) { b.dataset.t = b.textContent; b.textContent = label || "잠시만요…"; b.disabled = true; } else { b.textContent = b.dataset.t || b.textContent; b.disabled = false; } }
  function field(id, label, type, extra, help) {
    return '<div class="cc-field"><label for="' + id + '">' + label + "</label>" +
      (type === "password" ? '<div class="cc-pw"><input id="' + id + '" type="password" ' + (extra || "") + '><button type="button" class="cc-eye" data-eye="' + id + '" aria-label="비밀번호 보이기" aria-pressed="false">보기</button></div>' : '<input id="' + id + '" type="' + type + '" ' + (extra || "") + ">") +
      (help ? '<small>' + help + "</small>" : "") + "</div>";
  }
  function wireEyes() { dlg.querySelectorAll("[data-eye]").forEach(function (b) { b.onclick = function () { var i = $(b.dataset.eye), on = i.type === "password"; i.type = on ? "text" : "password"; b.textContent = on ? "숨기기" : "보기"; b.setAttribute("aria-pressed", on); }; }); }
  function onEnter(fn) { dlg.querySelectorAll("input").forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); fn(); } }); }); }

  // 첫 화면: 지금 상태에 맞는 창
  CC.open = function () {
    if (!CC.configured()) return showLocal();
    if (!CC.user()) return showLogin();
    if (!CC.center()) return showCenters();
    return showCenter();
  };
  function aboutAB() {
    return '<div class="cc-ab"><div><b>지금: 이 컴퓨터에만 저장</b><span>무료 · 아동 정보가 밖으로 나가지 않음 · 다른 컴퓨터와 이어지지 않음</span></div>' +
      '<div class="on"><b>센터 계정으로 바꾸면</b><span>어느 컴퓨터·휴대폰에서든 로그인하면 우리 센터 기록이 보이고, 선생님 여러 명이 함께 써요</span></div></div>';
  }
  /* ---------- 내 기록은 어디에? (이 컴퓨터에만 저장할 때: 개인정보 안내·백업·모두 지우기) ---------- */
  var KEEP_CC = { "cc.config": 1, "cc.zoom": 1, "cc.theme": 1 };   // 화면 설정·서버 주소는 개인정보가 아니라 남김
  function wipeKeys() {
    var pre = ((spec && spec.wipe && spec.wipe.prefixes) || []).concat(["cc."]), out = [];
    if (spec && spec.keys) spec.keys.forEach(function (k) { pre.push(k.k); });
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (!KEEP_CC[k] && k.indexOf("cc.tour") !== 0 && pre.some(function (p) { return k === p || k.indexOf(p) === 0; })) out.push(k); } } catch (e) {}
    return out;
  }
  CC.wipeKeys = wipeKeys;
  CC.wipeLocal = function () {
    wipeKeys().forEach(function (k) { try { CC._quiet++; localStorage.removeItem(k); } catch (e) {} finally { CC._quiet--; } });
    var dbs = (spec && spec.wipe && spec.wipe.idb) || [];
    return Promise.all(dbs.map(function (n) { return new Promise(function (res) { try { var r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; } catch (e) { res(); } }); }));
  };
  function showLocal() {
    var n = wipeKeys().filter(function (k) { return k.indexOf("cc.") !== 0; }).length, label = n ? "있음" : "없음";
    try { if (spec.localText) label = spec.localText(); else if (!spec.custom && spec.countText) label = spec.countText(Object.keys(localRows()).length); } catch (e) {}
    openDlg("내 기록은 어디에 있나요?", aboutAB() +
      '<div class="cc-warn"><b>개인정보 안내</b><ul class="cc-list">' +
      "<li>적은 기록은 <b>이 컴퓨터의 이 브라우저</b>에만 저장돼요. 인터넷으로 보내지 않아요.</li>" +
      (spec && spec.privacyNote ? "<li>" + spec.privacyNote + "</li>" : "") +
      "<li>브라우저의 <b>'인터넷 사용 기록 삭제'</b>를 하면 기록도 지워질 수 있어요. <b>한 달에 한 번 백업 파일</b>을 받아 두세요.</li>" +
      "<li>아동 이름 대신 <b>'○○ 아동'</b>처럼 적으면 더 안전해요.</li>" +
      "<li>여러 사람이 쓰는 컴퓨터이거나, 컴퓨터를 바꾸거나, 담당자가 바뀔 때는 <b>[이 컴퓨터 기록 모두 지우기]</b>를 눌러 주세요.</li></ul></div>" +
      '<p class="cc-small">지금 이 컴퓨터에 저장된 기록: <b id="ccLocalN">' + esc(label) + "</b></p>" +
      '<p class="cc-small">센터 계정(선생님 여러 명이 함께 쓰기)은 관리자가 서버를 한 번 연결해야 해요. ' +
      '<button type="button" class="cc-link" data-a="setup">' + (CC.configured() ? "센터 계정 로그인" : "센터 계정 연결 (관리자)") + "</button></p>",
      '<button type="button" class="cc-btn cc-danger-text" data-a="wipe">이 컴퓨터 기록 모두 지우기</button>' +
      (spec && spec.backup ? '<button type="button" class="cc-btn" data-a="backup">백업 파일 받기</button>' : "") +
      '<button type="button" class="cc-btn cc-main" data-a="close">닫기</button>');
    dlg.querySelector('[data-a="close"]').onclick = closeDlg;
    dlg.querySelector('[data-a="setup"]').onclick = function () { CC.configured() ? showLogin() : showSetup(); };
    var bk = dlg.querySelector('[data-a="backup"]'); if (bk) bk.onclick = function () { spec.backup(); };
    dlg.querySelector('[data-a="wipe"]').onclick = confirmWipe;
  }
  CC.showLocal = showLocal;
  function confirmWipe() {
    ask("이 컴퓨터 기록을 모두 지울까요?",
      "<p>이 컴퓨터에 저장된 <b>" + esc((spec && spec.appName) || "이 프로그램") + "</b>의 기록·사진·센터 정보가 모두 지워져요. <b>지운 기록은 되살릴 수 없어요.</b></p>" +
      "<p>필요한 기록이 있으면 먼저 <b>[백업 파일 받기]</b>를 눌러 파일로 받아 두세요. (글자 크기·화면 밝기 설정은 남아요)</p>",
      (spec && spec.backup ? [{ t: "백업 파일 먼저 받기", v: "backup" }] : []).concat([{ t: "취소", v: "" }, { t: "모두 지우기", v: "wipe", danger: true }])).then(function (v) {
      if (v === "backup") { spec.backup(); setTimeout(confirmWipe, 400); return; }
      if (v !== "wipe") return showLocal();
      CC.wipeLocal().then(function () {
        try { sessionStorage.setItem("cc.wiped", "1"); } catch (e) {}
        location.reload();
      });
    });
  }
  function showSetup() {
    var c = CC.config();
    openDlg("센터 계정 — 서버 연결", aboutAB() +
      "<p>센터 계정을 쓰려면 <b>관리자(센터장)가 한 번</b> 무료 Supabase 프로젝트를 만들고 주소와 공개 키를 넣어야 해요. 방법은 저장소의 <code>supabase/센터계정_설정안내.md</code>에 있어요.</p>" +
      field("ccUrl", "Project URL", "url", 'placeholder="https://xxxx.supabase.co" autocomplete="off" value="' + esc(c.url) + '"') +
      field("ccKey", "anon public 키", "text", 'placeholder="eyJ… 로 시작하는 긴 글자" autocomplete="off" spellcheck="false" value="' + esc(c.key) + '"', "공개용 키라서 화면에 보여도 괜찮아요. <b>service_role 키는 절대 넣지 마세요.</b>") +
      '<div id="ccErr"></div>',
      '<button type="button" class="cc-btn" data-a="close">지금은 이 컴퓨터에만 저장</button><button type="button" class="cc-btn cc-main" data-a="save">연결하기</button>');
    dlg.querySelector('[data-a="close"]').onclick = closeDlg;
    var save = function () {
      var url = $("ccUrl").value.trim().replace(/\/+$/, ""), key = $("ccKey").value.trim();
      if (!URL_OK.test(url)) return errBox("ccErr", "주소는 https:// 로 시작해야 해요. 예: https://abcd.supabase.co");
      if (/service_role/.test(atobSafe(key.split(".")[1]))) return errBox("ccErr", "service_role 키예요. 이 키는 넣으면 안 돼요. anon public 키를 넣어 주세요.");
      if (key.length < 20) return errBox("ccErr", "키가 너무 짧아요. 전체를 복사해 주세요.");
      LS.set("cc.config", { url: url, key: key }); emit(); showLogin();
    };
    dlg.querySelector('[data-a="save"]').onclick = save; onEnter(save);
  }
  function atobSafe(s) { try { return atob(String(s || "").replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { return ""; } }
  function showLogin(tab, msg) {
    tab = tab || "in";
    openDlg(tab === "in" ? "센터 계정 로그인" : "센터 계정 만들기",
      (msg ? '<p class="cc-ok">' + esc(msg) + "</p>" : "") +
      '<div class="cc-tabs" role="tablist"><button type="button" role="tab" aria-selected="' + (tab === "in") + '" data-tab="in">로그인</button><button type="button" role="tab" aria-selected="' + (tab === "up") + '" data-tab="up">처음이에요 (가입)</button></div>' +
      field("ccEmail", "이메일", "email", 'autocomplete="email" inputmode="email" value="' + esc(LS.get("cc.lastEmail", "")) + '"') +
      field("ccPw", "비밀번호", "password", 'autocomplete="' + (tab === "in" ? "current-password" : "new-password") + '"', tab === "up" ? "8자 이상, 숫자와 글자를 섞어 주세요." : "") +
      (tab === "up" ? field("ccPw2", "비밀번호 한 번 더", "password", 'autocomplete="new-password"') : "") +
      '<div id="ccErr"></div>' +
      (tab === "in" ? '<p class="cc-small"><button type="button" class="cc-link" data-a="forgot">비밀번호를 잊었어요</button> · <button type="button" class="cc-link" data-a="where">이 컴퓨터 기록·개인정보 안내</button></p>' : '<p class="cc-small">한 사람이 계정 하나를 만들어요. 같은 센터 선생님끼리 계정을 나눠 쓰지 마세요.</p>'),
      '<button type="button" class="cc-btn" data-a="local">이 컴퓨터에만 저장</button><button type="button" class="cc-btn cc-main" data-a="go">' + (tab === "in" ? "로그인" : "가입하기") + "</button>");
    wireEyes();
    dlg.querySelectorAll("[data-tab]").forEach(function (b) { b.onclick = function () { showLogin(b.dataset.tab); }; });
    dlg.querySelector('[data-a="local"]').onclick = closeDlg;
    var f = dlg.querySelector('[data-a="forgot"]'); if (f) f.onclick = showForgot;
    var wh = dlg.querySelector('[data-a="where"]'); if (wh) wh.onclick = showLocal;
    var go = function () {
      var email = $("ccEmail").value.trim(), pw = $("ccPw").value, b = dlg.querySelector('[data-a="go"]');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errBox("ccErr", "이메일 주소를 다시 확인해 주세요.");
      if (tab === "up") {
        if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z가-힣]/.test(pw)) return errBox("ccErr", "비밀번호는 8자 이상으로, 숫자와 글자를 섞어 주세요.");
        if (pw !== $("ccPw2").value) return errBox("ccErr", "두 비밀번호가 달라요.");
      } else if (!pw) return errBox("ccErr", "비밀번호를 적어 주세요.");
      LS.set("cc.lastEmail", email); busyBtn(b, true);
      (tab === "in" ? CC.signIn(email, pw) : CC.signUp(email, pw)).then(function (r) {
        busyBtn(b, false);
        if (r && r.needConfirm) return showLogin("in", email + " 메일함에서 [가입 확인] 링크를 누른 뒤 여기서 로그인해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.");
        showCenters();
      }, function (e) { busyBtn(b, false); errBox("ccErr", e); });
    };
    dlg.querySelector('[data-a="go"]').onclick = go; onEnter(go);
  }
  function showForgot() {
    openDlg("비밀번호 다시 정하기", "<p>가입한 이메일로 <b>비밀번호 다시 정하기</b> 링크를 보내 드려요. 링크를 누르면 이 프로그램이 열리고 새 비밀번호를 정할 수 있어요.</p>" +
      field("ccEmail", "이메일", "email", 'autocomplete="email" value="' + esc(LS.get("cc.lastEmail", "")) + '"') + '<div id="ccErr"></div>',
      '<button type="button" class="cc-btn" data-a="back">돌아가기</button><button type="button" class="cc-btn cc-main" data-a="go">링크 보내기</button>');
    dlg.querySelector('[data-a="back"]').onclick = function () { showLogin("in"); };
    var go = function () { var b = dlg.querySelector('[data-a="go"]'); busyBtn(b, true); CC.recover($("ccEmail").value.trim()).then(function () { showLogin("in", "메일을 보냈어요. 메일함의 링크를 눌러 주세요."); }, function (e) { busyBtn(b, false); errBox("ccErr", e); }); };
    dlg.querySelector('[data-a="go"]').onclick = go; onEnter(go);
  }
  function showNewPassword() {
    openDlg("새 비밀번호 정하기", field("ccPw", "새 비밀번호", "password", 'autocomplete="new-password"', "8자 이상, 숫자와 글자를 섞어 주세요.") + field("ccPw2", "한 번 더", "password", 'autocomplete="new-password"') + '<div id="ccErr"></div>',
      '<button type="button" class="cc-btn cc-main" data-a="go">바꾸기</button>');
    wireEyes();
    var go = function () {
      var pw = $("ccPw").value, b = dlg.querySelector('[data-a="go"]');
      if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z가-힣]/.test(pw)) return errBox("ccErr", "8자 이상, 숫자와 글자를 섞어 주세요.");
      if (pw !== $("ccPw2").value) return errBox("ccErr", "두 비밀번호가 달라요.");
      busyBtn(b, true); CC.setPassword(pw).then(function () { CC.toast("새 비밀번호로 바꿨어요."); CC.open(); }, function (e) { busyBtn(b, false); errBox("ccErr", e); });
    };
    dlg.querySelector('[data-a="go"]').onclick = go; onEnter(go);
  }
  function showCenters(msg) {
    openDlg("우리 센터 고르기", '<p class="cc-muted">로그인: ' + esc((CC.user() || {}).email) + "</p><div id='ccList'><p class='cc-muted'>센터 목록을 불러오는 중…</p></div>",
      '<button type="button" class="cc-btn cc-danger-text" data-a="out">로그아웃</button>');
    dlg.querySelector('[data-a="out"]').onclick = function () { CC.signOut(); };
    CC.myCenters().then(function (list) {
      var h = (msg ? '<p class="cc-ok">' + esc(msg) + "</p>" : "");
      if (list.length) h += '<div class="cc-cards">' + list.map(function (c, i) { return '<button type="button" class="cc-card" data-i="' + i + '"><b>' + esc(c.name) + "</b><span>" + (c.role === "owner" ? "센터장" : "선생님") + " · " + esc(c.display_name || "") + "</span></button>"; }).join("") + "</div><hr>";
      h += '<div class="cc-two"><button type="button" class="cc-card" data-a="join"><b>초대 코드로 들어가기</b><span>센터장님께 받은 8자리 코드가 있어요 (선생님)</span></button>' +
        '<button type="button" class="cc-card" data-a="new"><b>우리 센터 새로 만들기</b><span>처음 시작하는 센터장님·담당자</span></button></div>';
      $("ccList").innerHTML = h;
      dlg.querySelectorAll(".cc-card[data-i]").forEach(function (b) { b.onclick = function () { setCenter(list[+b.dataset.i]); closeDlg(); enter(); }; });
      dlg.querySelector('[data-a="join"]').onclick = showJoin;
      dlg.querySelector('[data-a="new"]').onclick = showCreate;
    }, function (e) { errBox("ccList", e); if (e && e.auth) showLogin("in", "다시 로그인해 주세요."); });
  }
  function showJoin() {
    openDlg("초대 코드로 들어가기", field("ccCode", "초대 코드 (8자리)", "text", 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" style="letter-spacing:.15em;text-transform:uppercase"') +
      field("ccMe", "내 이름", "text", 'autocomplete="name" maxlength="30" placeholder="예: 김선생"', "누가 기록을 고쳤는지 센터 선생님들에게 보여요.") + '<div id="ccErr"></div>',
      '<button type="button" class="cc-btn" data-a="back">돌아가기</button><button type="button" class="cc-btn cc-main" data-a="go">들어가기</button>');
    dlg.querySelector('[data-a="back"]').onclick = function () { showCenters(); };
    var go = function () {
      var code = $("ccCode").value.replace(/\s/g, "").toUpperCase(), me = $("ccMe").value.trim(), b = dlg.querySelector('[data-a="go"]');
      if (code.length < 6) return errBox("ccErr", "초대 코드를 다시 확인해 주세요.");
      if (!me) return errBox("ccErr", "내 이름을 적어 주세요.");
      busyBtn(b, true); CC.joinCenter(code, me).then(function () { closeDlg(); enter(); }, function (e) { busyBtn(b, false); errBox("ccErr", e); });
    };
    dlg.querySelector('[data-a="go"]').onclick = go; onEnter(go);
  }
  function showCreate() {
    openDlg("우리 센터 새로 만들기", field("ccName", "센터 이름", "text", 'maxlength="60" placeholder="예: 해솔지역아동센터"') + field("ccMe", "내 이름", "text", 'autocomplete="name" maxlength="30" placeholder="예: 박정환"') +
      '<div class="cc-warn"><b>꼭 확인해 주세요 — 아동 정보가 서버에 저장돼요</b><ul class="cc-list"><li>계획서·일지·교육 기록에 적은 <b>아동 이름·학년·의견</b>이 Supabase 서버에 저장돼요.</li><li>센터 <b>개인정보 처리방침</b>에 이 내용을 적고, 필요하면 <b>보호자 동의</b>를 받아 주세요.</li><li><b>아동 사진은 서버에 올라가지 않고</b> 찍은 컴퓨터에만 남아요.</li><li>그만둔 선생님은 [선생님 목록]에서 내보내고 초대 코드를 새로 만들어 주세요.</li></ul>' +
      '<label class="cc-check"><input type="checkbox" id="ccAck"> 위 내용을 확인했고, 센터에서 개인정보 관리를 책임지겠습니다.</label></div><div id="ccErr"></div>',
      '<button type="button" class="cc-btn" data-a="back">돌아가기</button><button type="button" class="cc-btn cc-main" data-a="go">센터 만들기</button>');
    dlg.querySelector('[data-a="back"]').onclick = function () { showCenters(); };
    var go = function () {
      var name = $("ccName").value.trim(), me = $("ccMe").value.trim(), b = dlg.querySelector('[data-a="go"]');
      if (!name) return errBox("ccErr", "센터 이름을 적어 주세요.");
      if (!me) return errBox("ccErr", "내 이름을 적어 주세요.");
      if (!$("ccAck").checked) return errBox("ccErr", "개인정보 안내를 읽고 확인란에 표시해 주세요.");
      busyBtn(b, true); CC.createCenter(name, me, true).then(function () { closeDlg(); enter(); }, function (e) { busyBtn(b, false); errBox("ccErr", e); });
    };
    dlg.querySelector('[data-a="go"]').onclick = go;
  }
  function when(t) { var d = new Date(t), n = Date.now() - d.getTime(); if (n < 60000) return "방금"; if (n < 3600000) return Math.floor(n / 60000) + "분 전"; if (n < 86400000) return Math.floor(n / 3600000) + "시간 전"; return (d.getMonth() + 1) + "/" + d.getDate(); }
  function showCenter() {
    var c = CC.center(), owner = c.role === "owner", s = status;
    var sline = s.state === "ok" ? "모두 맞췄어요 · " + (s.last ? when(s.last) : "") : s.state === "pending" ? "보내는 중 (" + s.pending + "건)" : s.state === "offline" ? "인터넷이 끊겼어요. 이 컴퓨터에 보관했다가 연결되면 보내요." : s.state === "error" ? (s.msg || "확인이 필요해요") : "";
    openDlg(c.name,
      '<div class="cc-row"><span class="cc-pill on">센터 계정</span><span>' + esc((CC.user() || {}).email) + " · " + (owner ? "센터장" : "선생님") + "</span></div>" +
      (spec && !spec.custom ? '<div class="cc-row"><span>' + esc(sline) + '</span><button type="button" class="cc-btn cc-sm" data-a="sync">지금 맞추기</button></div>' : "") +
      '<section><h3>초대 코드</h3><div class="cc-row"><code class="cc-code" id="ccCodeV">' + esc(c.invite_code) + '</code><button type="button" class="cc-btn cc-sm" data-a="copy">복사</button>' +
      (owner ? '<button type="button" class="cc-btn cc-sm" data-a="rotate">새 코드 만들기</button>' : "") + '</div><p class="cc-small">새 선생님께 이 코드와 프로그램 주소를 알려 주세요. 가입 → [초대 코드로 들어가기]에 넣으면 돼요.</p></section>' +
      '<section><h3>선생님</h3><div id="ccPeople" class="cc-muted">불러오는 중…</div></section>' +
      (spec ? '<section><h3>최근에 고친 기록</h3><div id="ccRecent" class="cc-muted">불러오는 중…</div></section>' : "") +
      '<section><h3>내 이름</h3><div class="cc-row"><input id="ccMe" value="' + esc(c.display_name || "") + '" maxlength="30" aria-label="내 이름"><button type="button" class="cc-btn cc-sm" data-a="name">바꾸기</button></div></section><div id="ccErr"></div>',
      '<button type="button" class="cc-btn" data-a="switch">다른 센터</button><button type="button" class="cc-btn cc-main" data-a="close">닫기</button><button type="button" class="cc-btn cc-danger-text" data-a="out">로그아웃</button>');
    var on = function (a, fn) { var b = dlg.querySelector('[data-a="' + a + '"]'); if (b) b.onclick = fn; };
    dlg.querySelector('[data-a="close"]').focus();   // 정보 창이라 입력 칸 대신 [닫기]에 초점
    on("close", closeDlg); on("out", function () { CC.signOut(); });
    on("switch", function () { showCenters(); });
    on("sync", function () { var b = dlg.querySelector('[data-a="sync"]'); busyBtn(b, true, "맞추는 중…"); syncNow({ loud: true }).then(function () { showCenter(); }); });
    on("copy", function () { copy(c.invite_code); CC.toast("초대 코드를 복사했어요."); });
    on("rotate", function () {
      ask("초대 코드 새로 만들기", "<p>예전 코드로는 더 이상 들어올 수 없어요. 이미 들어온 선생님은 그대로예요.</p>", [{ t: "새로 만들기", v: "y", main: true }, { t: "그만두기", v: "n" }]).then(function (v) {
        if (v !== "y") return showCenter();
        CC.rpc("rotate_invite", { p_center: c.id }).then(function (code) { c.invite_code = code; setCenter(c); showCenter(); CC.toast("초대 코드를 새로 만들었어요."); }, function (e) { showCenter(); CC.toast(e.msg); });
      });
    });
    on("name", function () { var v = $("ccMe").value.trim(); if (!v) return; CC.rpc("set_my_name", { p_center: c.id, p_display_name: v }).then(function () { c.display_name = v; setCenter(c); CC.toast("이름을 바꿨어요."); }, function (e) { errBox("ccErr", e); }); });
    CC.rpc("center_people", { p_center: c.id }).then(function (list) {
      var el = $("ccPeople"); if (!el) return;
      el.className = ""; el.innerHTML = '<ul class="cc-people">' + list.map(function (p) {
        return "<li><b>" + esc(p.display_name || "이름 없음") + "</b> <span class='cc-muted'>" + (p.role === "owner" ? "센터장" : "선생님") + (p.is_me ? " · 나" : "") + "</span>" +
          (owner && !p.is_me ? '<button type="button" class="cc-link cc-danger-text" data-rm="' + esc(p.user_id) + '" data-n="' + esc(p.display_name) + '">내보내기</button>' : "") + "</li>";
      }).join("") + "</ul>";
      el.querySelectorAll("[data-rm]").forEach(function (b) {
        b.onclick = function () {
          ask("선생님 내보내기", "<p><b>" + esc(b.dataset.n) + "</b> 선생님이 더 이상 센터 기록을 볼 수 없게 할까요? 그만둔 선생님이라면 초대 코드도 새로 만들어 주세요.</p>", [{ t: "내보내기", v: "y", danger: true }, { t: "그만두기", v: "n" }]).then(function (v) {
            if (v !== "y") return showCenter();
            CC.rpc("remove_member", { p_center: c.id, p_user: b.dataset.rm }).then(function () { showCenter(); CC.toast("내보냈어요."); }, function (e) { showCenter(); CC.toast(e.msg); });
          });
        };
      });
    }, function (e) { errBox("ccPeople", e); });
    if (spec) CC.rpc("center_recent", { p_center: c.id, p_app: spec.app, p_limit: 8 }).then(function (list) {
      var el = $("ccRecent"); if (!el) return;
      el.className = "";
      el.innerHTML = list.length ? '<ul class="cc-people">' + list.map(function (h) { return "<li><span>" + esc(spec.keyLabel ? spec.keyLabel(h.key) : h.key) + "</span> <b>" + esc(h.action) + "</b> <span class='cc-muted'>" + esc(h.by_name || "") + " · " + when(h.at) + "</span></li>"; }).join("") + "</ul>" : "<p class='cc-muted'>아직 없어요.</p>";
    }, function () {});
  }
  function copy(t) { try { navigator.clipboard.writeText(t); } catch (e) { var i = document.createElement("textarea"); i.value = t; document.body.appendChild(i); i.select(); try { document.execCommand("copy"); } catch (x) {} i.remove(); } }

  // 센터에 들어온 뒤
  function enter() {
    emit();
    if (!spec) return;
    if (spec.custom) { if (spec.onEnter) spec.onEnter(); return; }
    firstSync().then(function () { startLoops(); }, function () {});
  }

  /* ---------- 8) 시작 ---------- */
  // spec: { app, appName, keys:[{k, map:'object'|'array', id}], onRemote(keys, who), countText(n), keyLabel(rowKey), custom, onEnter, onSignOut, chip }
  CC.init = function (sp) {
    spec = sp; injectCss();
    if (sp.chip) CC.mountChip(sp.chip);
    if (!sp.custom) {
      st = LS.get(stKey(), null);
      // 로그아웃된 채로 센터 기록이 남아 있으면(다른 프로그램에서 로그아웃 등) 보낼 것이 없을 때 이 컴퓨터에서 지움
      if (st && (!CC.isCenter() || CC.center().id !== st.center)) {
        if (!diff().length) { clearLocal(); LS.del(stKey()); st = null; }
        else setTimeout(function () { CC.toast("서버로 보내지 못한 기록이 있어요. [센터 계정]에서 다시 로그인해 주세요."); }, 800);
      }
    }
    try { if (sessionStorage.getItem("cc.wiped")) { sessionStorage.removeItem("cc.wiped"); setTimeout(function () { CC.toast("이 컴퓨터에 저장된 기록을 모두 지웠어요."); }, 300); } } catch (e) {}
    if (linkError) setTimeout(function () { CC.toast("메일 링크가 만료됐거나 맞지 않아요. 다시 시도해 주세요."); }, 300);
    if (linkType === "recovery") setTimeout(showNewPassword, 300);
    else if (linkType) setTimeout(function () { CC.toast("가입을 확인했어요. 이제 센터를 고르거나 만들어 주세요."); CC.open(); }, 300);
    if (CC.isCenter()) {
      if (sp.custom) { /* 차량 지킴이처럼 따로 맞추는 프로그램은 스스로 시작 */ }
      else if (!st) firstSync().then(startLoops, function () {});
      else { status.state = "ok"; syncNow(); startLoops(); }
    }
    emit();
    return CC;
  };
  CC.setStatus = function (s, pending, msg) { status.state = s; if (pending != null) status.pending = pending; if (s === "ok") status.last = Date.now(); status.msg = msg || ""; emit(); };

  /* ---------- 9) 글자 크기 (40~50대 선생님 의견: 글씨를 키울 수 있게) ---------- */
  var ZOOMS = [1, 1.12, 1.25];
  function applyZoom() { var z = ZOOMS[LS.get("cc.zoom", 0)] || 1; document.documentElement.style.zoom = z === 1 ? "" : String(z); document.documentElement.dataset.zoom = z; }
  CC.mountZoom = function (el) {
    if (!el) return; el.type = "button"; el.classList.add("cc-zoom");
    var paint = function () { var i = LS.get("cc.zoom", 0) || 0; el.innerHTML = '<span aria-hidden="true">가<b>가</b></span> <span class="cc-lbl">' + ["글자 보통", "글자 크게", "글자 아주 크게"][i] + "</span>"; el.setAttribute("aria-label", "글자 크기 바꾸기 (지금: " + ["보통", "크게", "아주 크게"][i] + ")"); };
    el.addEventListener("click", function () { LS.set("cc.zoom", ((LS.get("cc.zoom", 0) || 0) + 1) % ZOOMS.length); applyZoom(); paint(); });
    paint();
  };
  applyZoom();

  /* ---------- 9-1) 화면 밝게·어둡게 (팀 프로젝트 「화면 라이트·다크」, 이 브라우저에 기억) ---------- */
  function applyTheme() { var t = LS.get("cc.theme", ""); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
  CC.mountTheme = function (el) {
    if (!el) return; el.type = "button"; el.classList.add("cc-zoom");
    var names = { "": "화면 자동", light: "화면 밝게", dark: "화면 어둡게" }, icons = { "": "◐", light: "☀", dark: "☾" };
    var paint = function () { var t = LS.get("cc.theme", ""); el.innerHTML = '<span aria-hidden="true">' + icons[t] + '</span> <span class="cc-lbl">' + names[t] + "</span>"; el.setAttribute("aria-label", "화면 밝기 바꾸기 (지금: " + names[t] + ")"); };
    el.addEventListener("click", function () { var order = ["", "light", "dark"], t = LS.get("cc.theme", ""); LS.set("cc.theme", order[(order.indexOf(t) + 1) % 3]); applyTheme(); paint(); });
    paint();
  };
  applyTheme();

  /* ---------- 10) 처음 온 사람 사용 안내 (팀 프로젝트 「사용 안내」 방식: 화면을 차례로 밝혀 줌) ---------- */
  // steps: [{ target: 'CSS 선택자'(없으면 가운데), title, body }]
  CC.tour = function (steps, key, force) {
    if (!force && LS.get("cc.tour." + key, false)) return;
    injectCss();
    var i = 0, wrap = document.createElement("div"), last = document.activeElement;
    wrap.className = "cc-tour"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-labelledby", "ccTourT");
    wrap.innerHTML = '<div class="cc-tour-hole"></div><div class="cc-tour-card" tabindex="-1"></div>';
    document.body.appendChild(wrap);
    var hole = wrap.firstChild, card = wrap.lastChild;
    function done() { LS.set("cc.tour." + key, true); wrap.remove(); document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", draw); if (last && last.focus) last.focus(); }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(); } else if (e.key === "ArrowRight" || (e.key === "Enter" && e.target.tagName !== "BUTTON")) { e.preventDefault(); next(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); next(-1); } }
    function next(d) { i += d; if (i >= steps.length) return done(); if (i < 0) i = 0; draw(); }
    function draw() {
      var s = steps[i], t = s.target && document.querySelector(s.target), z = parseFloat(document.documentElement.dataset.zoom) || 1;
      if (t && t.getClientRects().length) {
        t.scrollIntoView({ block: "center", behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
        var r = t.getBoundingClientRect(), pad = 8;
        hole.style.cssText = "display:block;left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
        var below = r.bottom + 220 < window.innerHeight / z;
        card.style.cssText = "left:" + Math.max(12, Math.min(r.left, window.innerWidth / z - 400)) + "px;" + (below ? "top:" + (r.bottom + 18) + "px" : "top:" + Math.max(12, r.top - 18 - 230) + "px");
        wrap.classList.remove("center");
      } else { hole.style.cssText = "display:none"; card.style.cssText = ""; wrap.classList.add("center"); }
      card.innerHTML = '<p class="cc-tour-n">' + (i + 1) + " / " + steps.length + '</p><h2 id="ccTourT">' + esc(s.title) + "</h2>" + [].concat(s.body).map(function (b) { return "<p>" + b + "</p>"; }).join("") +
        '<div class="cc-tour-btns"><button type="button" class="cc-btn cc-sm" data-t="skip">닫기</button><span></span>' + (i ? '<button type="button" class="cc-btn cc-sm" data-t="prev">← 이전</button>' : "") +
        '<button type="button" class="cc-btn cc-main cc-sm" data-t="next">' + (i === steps.length - 1 ? "시작하기" : "다음 →") + "</button></div>";
      card.querySelector('[data-t="skip"]').onclick = done;
      card.querySelector('[data-t="next"]').onclick = function () { next(1); };
      var p = card.querySelector('[data-t="prev"]'); if (p) p.onclick = function () { next(-1); };
      card.querySelector('[data-t="next"]').focus();
    }
    document.addEventListener("keydown", onKey, true); window.addEventListener("resize", draw);
    draw();
  };

  /* ---------- 11) 모양 ---------- */
  function injectCss() {
    if ($("ccCss")) return;
    var s = document.createElement("style"); s.id = "ccCss";
    s.textContent = [
      ".cc-chip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid #d6dbe4;background:#fff;color:#1f2a3d;font:600 15px/1.2 inherit;font-family:inherit;cursor:pointer;max-width:100%;white-space:nowrap}",
      ".cc-chip .cc-t{overflow:hidden;text-overflow:ellipsis;max-width:260px}.cc-chip:hover{border-color:#8a96aa}.cc-chip:focus-visible,.cc-zoom:focus-visible,.cc-btn:focus-visible,.cc-card:focus-visible,.cc-dlg input:focus-visible{outline:3px solid #2f6fdb;outline-offset:2px}",
      ".cc-dot{width:10px;height:10px;border-radius:50%;background:#c98a00;flex:none}.cc-chip[data-cc=local]{background:#fff7e0;border-color:#f0d58a;color:#7a5200}.cc-chip[data-cc=on]{background:#e8f6ee;border-color:#9fd4b4;color:#155c33}.cc-chip[data-cc=on] .cc-dot{background:#1f9d55}.cc-chip[data-cc=warn]{background:#fdecea;border-color:#f2b8b0;color:#9b1c10}.cc-chip[data-cc=warn] .cc-dot{background:#d93a26}",
      ".cc-zoom{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid #d6dbe4;background:#fff;color:#1f2a3d;font:600 15px/1.2 inherit;font-family:inherit;cursor:pointer;white-space:nowrap}.cc-zoom b{font-size:1.25em}",
      ".cc-dlg{border:0;border-radius:18px;padding:0;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 32px);color:#1f2a3d;background:#fff;box-shadow:0 24px 60px rgba(15,25,45,.28);font-family:inherit}",
      ".cc-dlg::backdrop{background:rgba(15,25,45,.45)}.cc-box{display:flex;flex-direction:column;max-height:calc(100vh - 32px)}",
      ".cc-dlg header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 24px 8px}.cc-dlg h2{margin:0;font-size:22px;line-height:1.3}.cc-dlg h3{margin:18px 0 8px;font-size:16px;color:#4a5568}",
      ".cc-x{border:0;background:transparent;font-size:22px;width:44px;height:44px;border-radius:50%;cursor:pointer;color:#4a5568}.cc-x:hover{background:#f1f3f7}",
      ".cc-body{padding:8px 24px 12px;overflow:auto;font-size:16px;line-height:1.65}.cc-body p{margin:8px 0}.cc-dlg footer{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;padding:14px 24px 20px;border-top:1px solid #edf0f4}",
      ".cc-dlg footer .cc-danger-text{margin-right:auto;order:-1}",
      ".cc-field{margin:14px 0}.cc-field label{display:block;font-weight:700;margin-bottom:6px}.cc-field small{display:block;color:#5b6474;margin-top:6px;font-size:14px}",
      ".cc-dlg input:not([type=checkbox]){width:100%;box-sizing:border-box;min-height:48px;padding:10px 14px;border:1.5px solid #c9d0db;border-radius:10px;font:inherit;font-size:17px;color:inherit;background:#fff}",
      ".cc-pw{display:flex;gap:8px}.cc-eye{flex:none;min-width:72px;border:1.5px solid #c9d0db;border-radius:10px;background:#f7f8fa;font:inherit;font-weight:600;cursor:pointer}",
      ".cc-btn{min-height:48px;padding:0 20px;border-radius:12px;border:1.5px solid #c9d0db;background:#fff;color:#1f2a3d;font:inherit;font-size:16px;font-weight:700;cursor:pointer}.cc-btn:hover{background:#f4f6f9}.cc-btn:disabled{opacity:.6;cursor:wait}",
      ".cc-main{background:#1f2a3d;border-color:#1f2a3d;color:#fff}.cc-main:hover{background:#2f3d55}.cc-danger{background:#b42318;border-color:#b42318;color:#fff}.cc-danger-text{color:#b42318}",
      ".cc-sm{min-height:40px;padding:0 14px;font-size:15px}.cc-link{border:0;background:none;color:#2457b8;text-decoration:underline;font:inherit;cursor:pointer;padding:4px}",
      ".cc-err{background:#fdecea;color:#9b1c10;border-radius:10px;padding:10px 14px;font-weight:600}.cc-ok{background:#e8f6ee;color:#155c33;border-radius:10px;padding:10px 14px;font-weight:600}",
      ".cc-warn{background:#fff7e0;border:1.5px solid #f0d58a;border-radius:12px;padding:12px 16px;margin:14px 0}.cc-list{margin:6px 0;padding-left:20px}.cc-list li{margin:4px 0}",
      ".cc-check{display:flex;gap:10px;align-items:flex-start;font-weight:700;margin-top:8px;cursor:pointer}.cc-check input{width:22px;height:22px;margin-top:3px;flex:none}",
      ".cc-tabs{display:flex;gap:4px;background:#f1f3f7;border-radius:12px;padding:4px;margin:6px 0 4px}.cc-tabs button{flex:1;min-height:44px;border:0;border-radius:9px;background:transparent;font:inherit;font-weight:700;color:#4a5568;cursor:pointer}.cc-tabs [aria-selected=true]{background:#fff;color:#1f2a3d;box-shadow:0 1px 3px rgba(0,0,0,.12)}",
      ".cc-cards,.cc-two{display:grid;gap:10px}.cc-two{grid-template-columns:1fr 1fr}@media(max-width:520px){.cc-two{grid-template-columns:1fr}}",
      ".cc-card{display:flex;flex-direction:column;gap:4px;text-align:left;padding:16px;border:1.5px solid #d6dbe4;border-radius:14px;background:#fff;font:inherit;cursor:pointer;color:inherit}.cc-card:hover{border-color:#1f2a3d;background:#f8fafc}.cc-card b{font-size:17px}.cc-card span{color:#5b6474;font-size:14.5px}",
      ".cc-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0}.cc-row input{flex:1;min-width:160px}.cc-code{font:700 24px/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;background:#f1f3f7;padding:10px 14px;border-radius:10px}",
      ".cc-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:14px;font-weight:700}.cc-pill.on{background:#e8f6ee;color:#155c33}",
      ".cc-people{list-style:none;margin:0;padding:0}.cc-people li{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #edf0f4}.cc-people .cc-link{margin-left:auto}",
      ".cc-muted{color:#5b6474}.cc-small{font-size:14.5px;color:#5b6474}.cc-dlg hr{border:0;border-top:1px solid #edf0f4;margin:14px 0}.cc-dlg code{background:#f1f3f7;border-radius:6px;padding:1px 6px}",
      ".cc-ab{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 12px}.cc-ab>div{border:1.5px solid #e3e7ee;border-radius:12px;padding:12px}.cc-ab>div.on{border-color:#9fd4b4;background:#f3fbf6}.cc-ab b{display:block;margin-bottom:4px}.cc-ab span{font-size:14.5px;color:#4a5568}@media(max-width:520px){.cc-ab{grid-template-columns:1fr}}",
      ".cc-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;pointer-events:none;max-width:min(560px,calc(100vw - 32px));background:#1f2a3d;color:#fff;padding:14px 20px;border-radius:14px;font-size:16px;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .2s,transform .2s;z-index:2147483000}.cc-toast.show{opacity:1;transform:translate(-50%,0)}",
      ".cc-tour{position:fixed;inset:0;z-index:2147483001}.cc-tour.center{background:rgba(15,25,45,.55)}.cc-tour-hole{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,25,45,.55);outline:3px solid #ffd23f;transition:all .2s}",
      ".cc-tour-card{position:fixed;width:min(380px,calc(100vw - 24px));background:#fff;color:#1f2a3d;border-radius:16px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-size:16px;line-height:1.6}.cc-tour.center .cc-tour-card{left:50%;top:50%;transform:translate(-50%,-50%)}",
      ".cc-tour-card h2{margin:2px 0 8px;font-size:20px}.cc-tour-card p{margin:6px 0}.cc-tour-n{color:#5b6474;font-size:14px;font-weight:700}.cc-tour-btns{display:flex;gap:8px;align-items:center;margin-top:14px}.cc-tour-btns span{flex:1}",
      "@media (prefers-reduced-motion: reduce){.cc-toast,.cc-tour-hole{transition:none}}",
      "@media (prefers-color-scheme: dark){html.cc-dark-ok:not([data-theme=light]) .cc-dlg,html.cc-dark-ok:not([data-theme=light]) .cc-tour-card{background:#1d2433;color:#e8ecf3}html.cc-dark-ok:not([data-theme=light]) .cc-dlg input:not([type=checkbox]),html.cc-dark-ok:not([data-theme=light]) .cc-btn:not(.cc-main):not(.cc-danger),html.cc-dark-ok:not([data-theme=light]) .cc-card,html.cc-dark-ok:not([data-theme=light]) .cc-chip:not([data-cc]),html.cc-dark-ok:not([data-theme=light]) .cc-zoom{background:#252e40;color:#e8ecf3;border-color:#3b4659}html.cc-dark-ok:not([data-theme=light]) .cc-main{background:#e8ecf3;color:#1d2433;border-color:#e8ecf3}html.cc-dark-ok:not([data-theme=light]) .cc-muted,html.cc-dark-ok:not([data-theme=light]) .cc-small,html.cc-dark-ok:not([data-theme=light]) .cc-card span,html.cc-dark-ok:not([data-theme=light]) .cc-ab span,html.cc-dark-ok:not([data-theme=light]) .cc-dlg h3{color:#aab4c5}html.cc-dark-ok:not([data-theme=light]) .cc-tabs,html.cc-dark-ok:not([data-theme=light]) .cc-code,html.cc-dark-ok:not([data-theme=light]) .cc-dlg code{background:#252e40}html.cc-dark-ok:not([data-theme=light]) .cc-tabs [aria-selected=true]{background:#3b4659;color:#fff}html.cc-dark-ok:not([data-theme=light]) .cc-warn{background:#3a3220;border-color:#6b5a2a}html.cc-dark-ok:not([data-theme=light]) .cc-dlg footer,html.cc-dark-ok:not([data-theme=light]) .cc-people li{border-color:#3b4659}}",
      "html.cc-dark-ok[data-theme=dark] .cc-dlg,html.cc-dark-ok[data-theme=dark] .cc-tour-card{background:#1d2433;color:#e8ecf3}html.cc-dark-ok[data-theme=dark] .cc-dlg input:not([type=checkbox]),html.cc-dark-ok[data-theme=dark] .cc-btn:not(.cc-main):not(.cc-danger),html.cc-dark-ok[data-theme=dark] .cc-card,html.cc-dark-ok[data-theme=dark] .cc-chip:not([data-cc]),html.cc-dark-ok[data-theme=dark] .cc-zoom{background:#252e40;color:#e8ecf3;border-color:#3b4659}html.cc-dark-ok[data-theme=dark] .cc-main{background:#e8ecf3;color:#1d2433;border-color:#e8ecf3}html.cc-dark-ok[data-theme=dark] .cc-muted,html.cc-dark-ok[data-theme=dark] .cc-small,html.cc-dark-ok[data-theme=dark] .cc-card span,html.cc-dark-ok[data-theme=dark] .cc-ab span,html.cc-dark-ok[data-theme=dark] .cc-dlg h3{color:#aab4c5}html.cc-dark-ok[data-theme=dark] .cc-tabs,html.cc-dark-ok[data-theme=dark] .cc-code,html.cc-dark-ok[data-theme=dark] .cc-dlg code{background:#252e40}html.cc-dark-ok[data-theme=dark] .cc-tabs [aria-selected=true]{background:#3b4659;color:#fff}html.cc-dark-ok[data-theme=dark] .cc-warn{background:#3a3220;border-color:#6b5a2a}html.cc-dark-ok[data-theme=dark] .cc-dlg footer,html.cc-dark-ok[data-theme=dark] .cc-people li{border-color:#3b4659}",
      "@media print{.cc-chip,.cc-zoom,.cc-toast,.cc-tour{display:none!important}}"
    ].join("\n");
    document.head.appendChild(s);
  }
})();
