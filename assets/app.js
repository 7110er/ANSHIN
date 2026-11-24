// 安心桃選 v9｜GitHub Pages 前端（無建置工具；原生 ES 模組）
// 身分：Google Identity Services → ID token 只用一次換發後端會話憑證（v9.1，滑動續期）；憑證與表單草稿存在 sessionStorage（全部分頁關閉即清）。
// v9.2：同網站其他分頁仍登入中時，新分頁經 BroadcastChannel 取得同一會話憑證，免重登；任一分頁按「登出」即全部分頁登出；開頁時後端暫時連不上不再清除有效憑證。
import { FIELD_ZH } from './labels.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const live = (t) => { const el = $('#live'); el.textContent = ''; setTimeout(() => { el.textContent = t; }, 30); };
const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(k); } catch (e) {} } };
// v9.6：前端建置識別＝本檔將此行引號內值換為 64 個 0 後之 SHA-256（build_v96.py 寫入）
const FRONT_BUILD_ID = 'bb279ccd9b13751e347b18c6412e00f3de04f9d6ca8ad7851663e6ff173e4601';
const S = { attest: null, release: null, cfg: null, token: null, session: null, me: null, reauth: null, view: 'board', parse: null, result: null, board: null, draft: {} };
// ── v9.2 分頁間共享會話憑證（只在同一瀏覽器、同網站、且至少一個已登入分頁仍開著時生效）
const SESS_CH = (() => { try { return new BroadcastChannel('anshin_v9_sess_share'); } catch (e) { return null; } })();
const TRANSIENT_CODES = ['NETWORK', 'TIMEOUT', 'SERVER_ERROR', 'BUSY', 'RATE_LIMIT'];
const sessValid = (s) => !!(s && typeof s.token === 'string' && s.token && s.expires_at > Date.now());
const sessSub = (tok) => { try { const p = String(tok || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).s || null; } catch (e) { return null; } };
function sessBroadcast(type, sess) { try { if (SESS_CH) SESS_CH.postMessage({ type, sess: sess || null }); } catch (e) {} }
function sessAskPeers(ms) {
  return new Promise((resolve) => {
    if (!SESS_CH) { resolve(null); return; }
    let done = false;
    const on = (ev) => { const d = ev.data || {}; if (d.type === 'give' && sessValid(d.sess)) fin(d.sess); };
    const fin = (v) => { if (done) return; done = true; SESS_CH.removeEventListener('message', on); resolve(v); };
    SESS_CH.addEventListener('message', on);
    sessBroadcast('ask');
    setTimeout(() => fin(null), ms || 700);
  });
}
if (SESS_CH) SESS_CH.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.type === 'ask') { if (S.me && sessValid(S.session)) sessBroadcast('give', S.session); return; }
  if (d.type === 'renew') {   // 他分頁續期：同一帳號且到期較晚才採用
    if (S.me && sessValid(d.sess) && S.session && sessSub(d.sess.token) && sessSub(d.sess.token) === sessSub(S.session.token) && d.sess.expires_at > S.session.expires_at) {
      S.session = d.sess; store.set('anshin_v9_sess', JSON.stringify(d.sess)); sessTick();
    }
    return;
  }
  if (d.type === 'signout' && S.me) signOut('已於其他分頁登出。', true);
});
const VIEWS = ['board', 'assess', 'dash', 'learn'];
const ROC7 = /^1\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
function phiScan(text) {
  const hits = [];
  (String(text).match(/\d{7,}/g) || []).forEach((d) => { if (!ROC7.test(d)) hits.push(`連續 ${d.length} 位數字`); });
  if (/(^|[^A-Za-z])[A-Za-z][12ABCD89]\d{8}(?!\d)/.test(text)) hits.push('身分證或居留證樣式');
  if (/姓名|病歷號|身分證|出生日期|生日[:：]/.test(text)) hits.push('識別欄位字樣');
  return hits;
}

// ── 設定與登入
// ── v10.0 本機引擎（藍圖 v21.1 P1）：加密引擎包 → Web Worker 判讀；伺服器只發金鑰、收結果。不支援時改用伺服器分析（較慢）。
const ENG = { w: null, ready: null, seq: 0, pend: {}, info: null, fallback_zh: '' };
function engCall(m, tr) { return new Promise((res) => { const id = ++ENG.seq; ENG.pend[id] = res; ENG.w.postMessage(Object.assign({ id }, m), tr || []); }); }
function idb() { return new Promise((res) => { try { const r = indexedDB.open('anshin-engine', 1); r.onupgradeneeded = () => r.result.createObjectStore('pack'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbGet(k) { const db = await idb(); if (!db) return null; return new Promise((res) => { try { const q = db.transaction('pack').objectStore('pack').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbPut(k, v) { const db = await idb(); if (!db) return; try { const st = db.transaction('pack', 'readwrite').objectStore('pack'); st.clear(); st.put(v, k); } catch (e) {} }
async function ensureEngine() {
  if (ENG.ready) return ENG.ready;
  ENG.ready = (async () => {
    const pk = S.release && S.release.pack;
    if (!pk || typeof Worker === 'undefined' || typeof DecompressionStream === 'undefined' || !window.crypto || !crypto.subtle) return { ok: false, error_zh: '此瀏覽器或網站版本不支援本機引擎' };
    const kr = await api('engine_key', { kid: pk.kid });
    if (!kr.ok) return kr;
    if (kr.code_build_id !== S.release.code_build_id) return { ok: false, error_zh: '後端與網站版本不同，無法啟用本機引擎' };
    let buf = await idbGet(pk.sha_cipher);
    if (!buf) { let r; try { r = await fetch(pk.file, { cache: 'no-store' }); } catch (e) { r = null; } if (!r || !r.ok) return { ok: false, error_zh: '引擎包下載失敗' }; buf = await r.arrayBuffer(); idbPut(pk.sha_cipher, buf); }
    ENG.w = new Worker('assets/engine-worker.js');
    ENG.w.onmessage = (e) => { const f = ENG.pend[e.data.id]; delete ENG.pend[e.data.id]; if (f) f(e.data.out); };
    ENG.w.onerror = () => { Object.keys(ENG.pend).forEach((k) => { ENG.pend[k]({ ok: false, error_zh: '本機引擎執行中斷' }); delete ENG.pend[k]; }); };
    const out = await engCall({ cmd: 'init', cipher: buf.slice(0), key_b64: kr.key_b64, sha_cipher: pk.sha_cipher, sha_plain: pk.sha_plain, code_build_id: S.release.code_build_id, role_code: kr.role_code });
    if (!out || !out.ok) return out || { ok: false, error_zh: '本機引擎啟動失敗' };
    ENG.info = { settings: kr.settings, settings_sha: kr.settings_sha, perm: kr.perm, role_code: kr.role_code, unit: kr.unit, init_ms: out.init_ms };
    return { ok: true };
  })();
  const r = await ENG.ready;
  if (!r.ok) { ENG.ready = null; if (ENG.w) { ENG.w.terminate(); ENG.w = null; } ENG.fallback_zh = r.error_zh || '本機引擎無法啟用'; }
  return r;
}
function engCtx() { return { perm: ENG.info.perm, role_code: ENG.info.role_code, unit: ENG.info.unit, settings: ENG.info.settings }; }
async function engineParse(lines) { const e = await ensureEngine(); return e.ok ? engCall({ cmd: 'parse', payload: { order_lines: lines }, ctx: engCtx() }).then((r) => Object.assign({ ok: r.ok !== false }, r)) : api('parse', { order_lines: lines }); }
// 本機分析＋伺服器記錄；本機引擎不可用時改用伺服器分析（結果相同、較慢）
async function engineCompute(d) {
  const out = await engCall({ cmd: 'analyze', payload: d, ctx: engCtx() });
  if (!out || !out.ok) return { r: out || { ok: false, error_zh: '本機引擎無回應' } };
  const er = out.er;
  return { r: Object.assign({ ok: true, engine_site: 'browser' }, er), rec: { alias: er.alias, unit: er.unit, today: er.today, review: er.review, demoted: er.demoted || [], pending_cards: er.pending_cards || [],
    urgency: er.urgency, unevaluated: { n: er.unevaluated ? er.unevaluated.n : 0 }, counts: out.counts, engine_ms: er.engine_ms, timing_v99: er.timing_v99, shadow_v10: er.shadow_v10 || [], tier1_shadow_v108: ((er.tier1_shadow || {}).items || []).map((x) => ({ situation: x.situation, status: x.status })),
    settings_sha: er.settings_sha, code_build_id: er.code_build_id, events: out.events || {} } };
}
async function engineAnalyze(d) {
  const e = await ensureEngine();
  if (!e.ok) { const r = await api('analyze', d); if (r.ok) r.engine_site = 'server'; return r; }
  const o = await engineCompute(d); if (!o.rec) return o.r;
  o.rec.req_id = o.rec.req_id || rid(); const r = o.r, rec = await api('record_result', o.rec);
  if (rec.ok) { r.encounter_id = rec.encounter_id; r.case_key = rec.case_key; r.persisted = rec.persisted; r.persist_error_zh = rec.persist_error_zh; r.events_persist_error_zh = rec.events_persist_error_zh; }
  else { r.persisted = false; r.persist_error_zh = '評估結果已產生，但紀錄未保存：' + (rec.error_zh || '後端未回應'); }
  return r;
}
async function loadRelease() { try { const r = await fetch('assets/release.json', { cache: 'no-store' }); S.release = r.ok ? await r.json() : null; } catch (e) { S.release = null; } try { await loadSite(); } catch (e2) {} }
async function loadConfig() {
  loadRelease();
  try { const r = await fetch('config.json', { cache: 'no-store' }); S.cfg = await r.json(); } catch (e) { S.cfg = null; }
  const c = S.cfg || {};
  const okApi = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(c.api_url || '') || /^\/api$/.test(c.api_url || '');
  const okCid = /\.apps\.googleusercontent\.com$/.test(c.client_id || '');
  if (c.hospital_name) $('#hospitalName').textContent = c.hospital_name;
  return okApi && okCid;
}
function showSetupError() {
  $('#loginMsg').innerHTML = '網站設定尚未完成：請在 GitHub 編輯 <code>config.json</code>，填入 Apps Script 網頁應用程式網址（<code>…/exec</code>）與 Google OAuth 用戶端 ID。';
}
function initGsi(tries = 0) {
  const g = window.google && window.google.accounts && window.google.accounts.id;
  if (!g) { if (tries > 80) { $('#loginMsg').textContent = '無法載入 Google 登入元件；請確認網路可連 accounts.google.com。'; return; } setTimeout(() => initGsi(tries + 1), 100); return; }
  g.initialize({ client_id: S.cfg.client_id, callback: (r) => onCredential(r.credential), auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup' });
  g.renderButton($('#gsiButton'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'zh-TW', width: 280 });
}
async function onCredential(tok) {
  S.token = tok;
  const prevPid = S.me && S.me.person_id;
  if (!S.reauth) $('#loginMsg').textContent = '驗證中…';
  const r = await api('session_open', {});
  S.token = null;   // ID token 不保存；之後只用會話憑證
  if (!r.ok) {
    if (S.reauth) { $('#reauthMsg').textContent = r.error_zh || '登入失敗'; return; }
    $('#loginMsg').textContent = r.error_zh || '登入失敗'; return;
  }
  if (S.reauth) {
    if (prevPid && r.person_id !== prevPid) { closeReauth(false); clearDraft(); S.me = r; enterApp(); live('已切換帳號；前一位使用者的輸入已清除。'); return; }
    S.me = r; closeReauth(true); return;
  }
  S.me = r; enterApp();
}
function setSession(sess) {
  if (!sess || !sess.token) return;
  S.session = sess; store.set('anshin_v9_sess', JSON.stringify(sess)); sessTick();
  sessBroadcast('renew', sess);
}
function signOut(msg, fromPeer) {
  if (!fromPeer) sessBroadcast('signout');
  S.token = null; S.session = null; S.me = null; store.del('anshin_v9_sess'); clearDraft();
  try { window.google && window.google.accounts.id.disableAutoSelect(); } catch (e) {}
  $('#tabs').hidden = true; $('#who').hidden = true; $('#sessLeft').hidden = true;
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = true; });
  $('#view-login').hidden = false; $('#loginMsg').textContent = msg || ''; gsiVisible(true);
}
// ── 逾時重新登入：覆蓋式對話框，不換頁、不清輸入；登入後自動重送原請求
function openReauth(msgText) {
  if (S.reauth) return S.reauth.promise;
  let resolve; const promise = new Promise((r) => { resolve = r; });
  S.reauth = { promise, resolve };
  document.body.classList.add('reauth-lock'); try { $('#main').setAttribute('aria-hidden', 'true'); } catch (e) {}
  const d = $('#reauth'); $('#reauthMsg').textContent = /SESSION_|TOKEN_/.test(String(msgText || '')) ? '登入已逾時。' : '登入已逾時（約定之登入時數已到）。';
  try { window.google.accounts.id.renderButton($('#reauthGsi'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'zh-TW', width: 280 }); } catch (e) { $('#reauthMsg').textContent += '（無法載入 Google 登入元件，請確認網路）'; }
  if (d.showModal) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } } else d.setAttribute('open', '');
  live('登入已逾時；請重新登入，輸入已保留。');
  return promise;
}
function closeReauth(ok) {
  const d = $('#reauth'); try { d.close(); } catch (e) { d.removeAttribute('open'); }
  const r = S.reauth; S.reauth = null; if (r) r.resolve(ok);
  document.body.classList.remove('reauth-lock'); try { $('#main').removeAttribute('aria-hidden'); } catch (e) {}
  if (ok) live('已重新登入，繼續剛才的操作。');
}
const TIMEOUT_S = Object.assign({ analyze: 340, parse: 90, dashboard: 90 }, window.__ANSHIN_TIMEOUT_OVERRIDE__ || {});   // 覆寫只供端對端測試
const RETRY_SAFE = ['whoami', 'kanban_list', 'dashboard', 'my_learning', 'teach_queue', 'parse', 'record_result', 'record_results', 'feedback'];   // v10.4：寫入類以 req_id 冪等，可安全重送
const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)));
async function api(action, payload, _retried) {
  if (!S.cfg) return { ok: false, error_zh: '網站設定未完成' };
  const body = { action, payload: payload || {} };
  if (action === 'session_open' || !S.session) body.id_token = S.token; else body.session = S.session.token;
  const sec = TIMEOUT_S[action] || 45, ac = new AbortController(), to = setTimeout(() => ac.abort(), sec * 1000);
  let j;
  try {
    const r = await fetch(S.cfg.api_url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ac.signal });
    j = await r.json();
  } catch (e) {
    clearTimeout(to);
    if (!_retried && RETRY_SAFE.includes(action)) return api(action, payload, true);
    return e && e.name === 'AbortError'
      ? { ok: false, error_code: 'TIMEOUT', error_zh: `伺服器超過 ${sec} 秒未回應；輸入已保留，請再試一次。` }
      : { ok: false, error_code: 'NETWORK', error_zh: '無法連線到後端；輸入已保留，請確認網路後再試。' };
  }
  clearTimeout(to);
  if (j && j.session) setSession(j.session);
  if (j && !j.ok && action !== 'session_open' && /^(SESSION_|TOKEN_)/.test(j.error_code || '') && S.me && !_retried) {
    S.session = null; store.del('anshin_v9_sess');
    const ok = await openReauth(j.error_zh);
    return ok ? api(action, payload, true) : { ok: false, error_code: 'REAUTH_CANCELLED', error_zh: '未重新登入；輸入已保留。' };
  }
  return j;
}
// ── 會話剩餘時間：剩 15 分鐘內於頂列顯示並可延長（任一請求在剩 30 分鐘內都會自動續期）
let _sessTimer = null;
function sessTick() {
  clearInterval(_sessTimer);
  const upd = () => {
    const el = $('#sessLeft'); if (!S.session || !S.me) { el.hidden = true; return; }
    const m = Math.floor((S.session.expires_at - Date.now()) / 60000);
    if (m > 15) { el.hidden = true; return; }
    el.hidden = false; $('#sessLeftTxt').textContent = m > 0 ? `登入剩 ${m} 分鐘` : '登入已到期';
  };
  upd(); _sessTimer = setInterval(upd, 30000);
}
// ── 表單草稿（只存本分頁；化名、單位、檢驗、醫囑文字；關分頁即清）
const DRAFT_KEY = 'anshin_v9_draft';
const draftKey = (el) => el.id || (el.dataset.lab ? 'lab:' + el.dataset.lab : (el.dataset.flag ? 'flag:' + el.dataset.flag : ''));
function saveDraft() {
  const d = {}; $$('#assessForm input, #assessForm select, #assessForm textarea').forEach((el) => { const k = draftKey(el); if (!k) return; d[k] = el.type === 'checkbox' ? el.checked : el.value; });
  store.set(DRAFT_KEY, JSON.stringify(d));
}
function restoreDraft() {
  let d = null; try { d = JSON.parse(store.get(DRAFT_KEY) || 'null'); } catch (e) { d = null; }
  if (!d) return false;
  $$('#assessForm input, #assessForm select, #assessForm textarea').forEach((el) => { const k = draftKey(el); if (!k || !(k in d)) return; if (el.type === 'checkbox') el.checked = !!d[k]; else el.value = d[k]; });
  return true;
}
function clearDraft() { store.del(DRAFT_KEY); }
function enterApp() {
  const m = S.me;
  $('#view-login').hidden = true; $('#tabs').hidden = false; $('#who').hidden = false;
  $('#whoRole').textContent = `${m.role_zh}${m.perm === 'general' ? '' : '・' + ({ teacher: '教師', learner: '學員', admin: '管理者' }[m.perm])}${m.unit ? '・' + m.unit : ''}`;
  if (m.hospital_name) $('#hospitalName').textContent = m.hospital_name;
  $('#ver').textContent = m.version || '';
  attestCheck();
  $('#dashHealth').hidden = m.perm !== 'admin';
  $('#f_unit').value = $('#f_unit').value || m.unit || '';
  const units = ['__all__'].concat(m.units || []);
  ['#boardUnit', '#dashUnit'].forEach((id) => { $(id).innerHTML = units.map((u) => `<option value="${esc(u)}"${u === (m.unit || '__all__') ? ' selected' : ''}>${u === '__all__' ? '全部單位' : esc(u)}</option>`).join(''); });
  if (m.unit && !(m.units || []).includes(m.unit)) { ['#boardUnit', '#dashUnit'].forEach((id) => { $(id).insertAdjacentHTML('beforeend', `<option value="${esc(m.unit)}" selected>${esc(m.unit)}</option>`); }); }
  const restored = restoreDraft();
  go(restored && $('#f_orders').value.trim() ? 'assess' : (location.hash.replace('#', '') || 'board'));
  if (restored && $('#f_orders').value.trim()) live('已還原本分頁先前的輸入。');
  sessTick();
}
function go(v) {
  if (!VIEWS.includes(v)) v = 'board';
  S.view = v;
  VIEWS.forEach((x) => { $(`#view-${x}`).hidden = x !== v; });
  $$('#tabs button').forEach((b) => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  $('#main').focus({ preventScroll: true });
  if (v === 'board') loadBoard();
  if (v === 'dash') loadDash();
  if (v === 'learn') loadLearn();
}

// ── 今日看板
const COL_HINT = { queue: '加入後待藥師評估', today: '有今日須處理項目', advised: '已把建議交給醫師', replied: '醫師已回覆（採納與否）', closed: '本次住院用藥評估結束' };
async function loadBoard() {
  const b = $('#board'); b.setAttribute('aria-busy', 'true');
  const r = await api('kanban_list', { unit: $('#boardUnit').value || '__all__' });
  b.removeAttribute('aria-busy');
  if (!r.ok) { b.innerHTML = `<p class="msg err">${esc(r.error_zh)}</p>`; return; }
  S.board = r; renderBoard();
  if (r.test_hidden_n) b.insertAdjacentHTML('afterbegin', `<p class="muted" role="note" style="flex-basis:100%">已隱藏測試資料 ${r.test_hidden_n} 位（化名以 R##-／合成／測試／TEST 開頭）。</p>`);
}
function renderBoard() {
  const r = S.board, b = $('#board'), cols = r.columns;
  b.innerHTML = cols.map((c, ci) => {
    const cards = r.cards.filter((k) => k.status === c.id).sort((a, z) => z.today_n - a.today_n || (a.updated_at < z.updated_at ? 1 : -1));
    return `<section class="col" data-col="${c.id}" aria-labelledby="col-${c.id}">
      <div class="col-head"><h2 id="col-${c.id}" title="${esc(COL_HINT[c.id])}">${esc(c.zh)}</h2><span class="n" aria-label="${c.n} 位">${c.n}</span></div>
      ${cards.length ? cards.map((k) => kcard(k, ci, cols)).join('') : `<p class="empty-col">${esc(COL_HINT[c.id])}</p>`}
      ${c.id !== 'closed' && cards.some((k) => k.stale_72h && !(k.today_n > 0)) ? `<button class="btn ghost" data-batch-close="${c.id}">批次結案：72 小時未更新且無今日項目（${cards.filter((k) => k.stale_72h && !(k.today_n > 0)).length}）</button>` : ''}
    </section>`;
  }).join('');
  $$('[data-batch-close]', b).forEach((bt) => bt.addEventListener('click', async () => {
    const keys = r.cards.filter((k) => k.status === bt.dataset.batchClose && k.stale_72h && !(k.today_n > 0)).map((k) => k.case_key);
    const x = await api('kanban_close_batch', { case_keys: keys }); live(x.ok ? `已結案 ${x.closed.length} 張；略過 ${x.skipped.length} 張` : (x.error_zh || '批次結案失敗')); if (x.ok) loadBoard();
  }));
  $$('.kcard', b).forEach((el) => {
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.key); el.setAttribute('aria-grabbed', 'true'); });
    el.addEventListener('dragend', () => el.setAttribute('aria-grabbed', 'false'));
  });
  $$('.col', b).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop'); move(e.dataTransfer.getData('text/plain'), col.dataset.col); });
  });
}
function kcard(k, ci, cols) {
  const prev = cols[ci - 1], next = cols[ci + 1];
  const t = new Date(k.updated_at), when = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return `<article class="kcard" draggable="true" data-key="${esc(k.case_key)}" aria-label="${esc(k.alias)}，${esc(k.status_zh)}">
    <div class="k-top"><span class="alias">${esc(k.alias)}</span>${k.is_test ? '<span class="badge">測試</span>' : ''}${k.stale_72h ? '<span class="badge" title="72 小時未更新">待追蹤</span>' : ''}<span class="meta">${esc(k.unit || '')}</span></div>
    <div class="meta">更新 ${esc(when)}${k.mine ? '・我' : ''}</div>
    <div class="stats">${k.today_n ? `<span class="badge sev">今日 ${k.today_n}</span>` : ''}${k.unevaluated_n ? `<span class="badge sev">未評估 ${k.unevaluated_n}</span>` : ''}${k.urgency_zh ? `<span class="badge">急迫度 ${esc(k.urgency_zh)}</span>` : ''}</div>
    <div class="k-actions">
      ${prev ? `<button type="button" data-move="${prev.id}" aria-label="移到${esc(prev.zh)}">◀</button>` : ''}
      <button type="button" class="grow" data-open="${esc(k.alias)}">評估</button>
      ${next ? `<button type="button" data-move="${next.id}" aria-label="移到${esc(next.zh)}">▶</button>` : ''}
    </div>
  </article>`;
}
async function move(key, to, outcome) {
  if (to === 'replied' && !outcome) { askOutcome(key); return; }
  const r = await api('kanban_move', { case_key: key, to, outcome });
  if (!r.ok) { live(r.error_zh); alertMsg(r.error_zh); return; }
  live(`已移到${({ queue: '待評估', today: '今日須處理', advised: '已建議', replied: '醫師已回覆', closed: '結案' })[to]}`);
  loadBoard();
}
function askOutcome(key) {
  const el = $(`.kcard[data-key="${CSS.escape(key)}"]`); if (!el) return;
  if ($('.outcome', el)) return;
  el.insertAdjacentHTML('beforeend', `<div class="outcome" role="group" aria-label="醫師回覆結果"><button type="button" data-out="adopted">已採納</button><button type="button" data-out="partial">部分採納</button><button type="button" data-out="not_adopted">未採納</button></div>`);
  $('.outcome button', el).focus();
}
function alertMsg(t) { const m = $('#boardSub'); m.textContent = t; m.classList.add('err'); setTimeout(() => { m.textContent = '每位病人一張卡；拖曳或按箭頭移動欄位。'; m.classList.remove('err'); }, 5000); }

// ── 病人評估
function linesOf() { return $('#f_orders').value.split(/\r?\n/).map((x) => x.replace(/\s+$/, '')).filter((x) => x.trim()); }
function collect() {
  const v = (id) => $(id).value.trim();
  const labs = {}, labs_age_h = {}; $$('[data-lab]').forEach((el) => { if (el.value !== '') { labs[el.dataset.lab] = el.value; if (el.dataset.ageH !== undefined && el.dataset.ageH !== '' && el.dataset.src === 'his') labs_age_h[el.dataset.lab === 'scr' ? 'scr' : el.dataset.lab] = Number(el.dataset.ageH); } });
  if ($('#f_scr').dataset.src === 'his' && $('#f_scr').dataset.ageH) labs_age_h.scr = Number($('#f_scr').dataset.ageH);
  const flags = {}; $$('[data-flag]').forEach((el) => { if (el.checked) flags[el.dataset.flag] = true; });
  return { alias: v('#f_alias'), unit: v('#f_unit'), admission_day: v('#f_adm'), icd: v('#f_icd'), labs, labs_age_h, flags, order_lines: linesOf(),
           patient: { age: v('#f_age'), sex: v('#f_sex'), weight_kg: v('#f_wt'), scr_mg_dl: v('#f_scr'), scr_days_ago: v('#f_scr_ago'), dialysis: $('#f_dialysis').checked } };
}
function msg(t, err) { const m = $('#assessMsg'); m.textContent = t || ''; m.classList.toggle('err', !!err); if (t) live(t); }
async function parse() {
  const lines = linesOf();
  if (!lines.length) { msg('請先貼上醫囑。', true); $('#f_orders').focus(); return null; }
  const phi = phiScan(lines.join('\n')); if (phi.length) { msg(`醫囑含可識別資料（${phi.join('、')}），請刪除後再送出。`, true); return null; }
  msg('逐行辨識中…');
  const r = await engineParse(lines);
  if (!r.ok) { msg(r.error_zh, true); return null; }
  S.parse = { text: lines.join('\n'), rows: r.line_status, counts: r.counts };
  renderConfirm(r); renderTrust();
  const amb = r.line_status.filter((x) => x.status === 'ambiguous').length, ne = r.counts.unevaluated;
  msg(amb ? `有 ${amb} 行需選擇品項，選完才能分析。` : (ne ? `${ne} 行未辨識，可在下表以成分名補登；未補登者不評估。` : '全部醫囑已辨識。'), !!amb);
  return S.parse;
}
function renderTrust() {
  const p = S.parse; if (!p) { $('#trust').innerHTML = ''; return; }
  const rows = p.rows.filter((x) => x.status !== 'not_medication'), res = rows.filter((x) => x.status === 'resolved');
  const fq = res.filter((x) => x.freq).length, c = p.counts;
  const m = (label, a, b) => { const pct = b ? Math.round(100 * a / b) : 0, cls = !b ? '' : pct >= 95 ? '' : pct >= 80 ? 'warn' : 'bad';
    return `<div class="meter ${cls}"><b>${label}</b><span class="v">${a}／${b}</span><div class="track" role="img" aria-label="${label} ${pct}%"><div class="fill" style="width:${pct}%"></div></div></div>`; };
  $('#trust').innerHTML = m('品名辨識', res.length, rows.length) + m('每日劑量', c.dose_num, c.dose_den) + m('頻次', fq, res.length);
}
const ST_ZH = { resolved: '已辨識', ambiguous: '需選擇', not_in_formulary: '主檔查無', unparseable: '無法解析', not_medication: '非藥品' };
const ROUTE_ZH = { oral: '口服', parenteral: '注射', transdermal: '貼片', inhalation: '吸入', topical: '外用', ophthalmic: '眼用', rectal: '肛門', unknown: '劑型未明' };
function renderConfirm(r) {
  const order = { ambiguous: 0, not_in_formulary: 1, unparseable: 2, resolved: 3, not_medication: 4 };
  const rows = r.line_status.map((x, k) => ({ x, k })).sort((a, b) => order[a.x.status] - order[b.x.status] || a.x.line_index - b.x.line_index);
  const reasons = (x) => (x.reasons || []).filter((q) => !(q.code === 'GRAMMAR_UNKNOWN_TOKEN' && x.status === 'resolved' && x.daily_mg && x.freq) && q.code !== 'FREQ_FROM_PAREN' && q.code !== 'COUNT_FROM_QTY').map((q) => q.zh);
  const dose = (x) => x.daily_mg ? Object.entries(x.daily_mg).map(([k, v]) => `${k} ${v} mg/日`).join('、') : '—';
  const tr = ({ x, k }) => {
    let act = '';
    if (x.status === 'ambiguous') act = (x.candidates || []).filter((c) => c.pick_line).map((c, ci) => `<button type="button" data-pick="${k}:${ci}">選 ${esc(c.product_name)}（${esc(ROUTE_ZH[c.route_class] || c.route_class || '')}｜${esc(c.his_code)}）</button>`).join('');
    if ((x.status === 'not_in_formulary' || x.status === 'unparseable') && x.backfill) act = `<input aria-label="以成分名補登：${esc(x.raw)}" data-bf="${k}" placeholder="成分名，例 ketorolac"><button type="button" data-bfgo="${k}">補登</button>`;
    const rs = reasons(x), ok = x.status === 'resolved';
    const meta = ok ? [x.freq ? x.freq + (x.freq_his_code ? `（HIS ${x.freq_his_code}）` : '') : '頻次未寫', ROUTE_CODE_ZH[x.route] || '', x.prn ? 'PRN' : '', x.source === 'home' ? '自備' : ''].filter(Boolean).join('｜') : '';
    return `<tr class="cf-row st-${x.status}"><td><span class="pill ${x.status}">${ST_ZH[x.status] || x.status}</span><div class="cf-sub">第 ${x.line_index + 1} 行${x.pick ? '・' + (x.pick.kind === 'pick' ? '藥師指定' : '藥師補登') : ''}</div></td>
      <td><div class="cf-raw">${esc(x.raw)}</div>${ok ? `<div class="cf-line"><span class="cf-id">${esc(x.product_name || (x.ingredients || []).join(' / '))}</span><span class="code">${esc(x.his_code || '')}</span><span class="cf-sub">${esc((x.ingredients || []).join(' / '))}</span></div>` : ''}
        ${ok ? `<div class="cf-line"><b>${esc(dose(x))}</b><span class="cf-sub">${esc(x.dose_formula_zh ? '＝' + x.dose_formula_zh : '')}</span></div><div class="cf-sub">${esc(meta)}</div>` : ''}
        ${rs.length ? `<div class="cf-sub">${esc(rs.join('；'))}</div>` : ''}${act ? `<div class="row-actions">${act}</div>` : ''}</td></tr>`;
  };
  const c = r.counts;
  $('#confirmWrap').hidden = false; $('#confirmWrap').open = true; $('#confirmSum').textContent = '逐行確認表';
  $('#confirm').innerHTML = `<div class="tbl-wrap"><table><caption>逐行確認：${c.lines} 行；已辨識 ${c.resolved}、未評估 ${c.unevaluated}、非藥品 ${c.non_med}</caption>
    <thead><tr><th scope="col" style="width:110px">狀態</th><th scope="col">原始醫囑 → 辨識結果｜每日劑量｜原因</th></tr></thead>
    <tbody>${rows.map(tr).join('')}</tbody></table></div>`;
}
function replaceLine(k, text) {
  const x = S.parse.rows[k]; const all = $('#f_orders').value.split(/\r?\n/); let idx = -1, seen = -1;
  for (let i = 0; i < all.length; i++) { if (all[i].trim()) { seen++; if (seen === x.line_index) { idx = i; break; } } }
  if (idx < 0) return; all[idx] = text; $('#f_orders').value = all.join('\n'); parse();
}
async function analyze(e) {
  if (e) e.preventDefault();
  const d = collect();
  if (!d.alias) { msg('請輸入病人化名。', true); $('#f_alias').focus(); return; }
  const phi = phiScan(JSON.stringify(d)); if (phi.length) { msg(`輸入含可識別資料（${phi.join('、')}），請刪除後再送出。`, true); return; }
  if (!S.parse || S.parse.text !== d.order_lines.join('\n')) { const p = await parse(); if (!p) return; }
  if (S.parse.rows.some((x) => x.status === 'ambiguous')) { msg('有醫囑需選擇品項，選完才能分析。', true); $('#confirm').scrollIntoView({ block: 'start' }); return; }
  const btn = $('#btnAnalyze'); btn.disabled = true; const t0 = Date.now();
  const tick = setInterval(() => msg(`分析中…已 ${Math.round((Date.now() - t0) / 1000)} 秒。逐行確認表可先檢視；結果回來後自動展開。`), 1000);
  const r = await engineAnalyze(d);
  clearInterval(tick); btn.disabled = false;
  if (!r.ok) { msg(r.error_zh, true); return; }
  S.result = r; const sec = (n) => (n == null ? '—' : (n / 1000).toFixed(1));
  const tm = r.engine_site === 'browser' ? `（本次 ${sec(Date.now() - t0)} 秒：本機判讀 ${sec(r.engine_ms)}）` : (r.timing_v99 ? `（本次 ${sec(Date.now() - t0)} 秒：伺服器分析${ENG.fallback_zh ? '，' + ENG.fallback_zh : ''}；後端 ${sec(r.server_ms)}）` : '');
  msg(`完成：今日須處理 ${r.today.length} 項${r.unevaluated.n ? `；未評估 ${r.unevaluated.n} 行` : ''}。${tm}${r.persist_error_zh ? '　' + r.persist_error_zh : ''}${r.events_persist_error_zh ? '　' + r.events_persist_error_zh : ''}`, !!r.persist_error_zh);
  renderResult();
  // F83：完成即見結果——收合逐行確認表，捲至結果並移焦點
  const cf = $('#confirmWrap'); if (cf && S.parse) { cf.open = false; $('#confirmSum').textContent = `逐行確認表（${S.parse.rows.length} 行；已辨識 ${S.parse.counts.resolved}）`; }
  const rs = $('#result'); rs.setAttribute('tabindex', '-1');
  rs.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); rs.focus({ preventScroll: true });
}
const FACT_ZH = { aki: '急性腎損傷判定（需 SCr 基線與時間）', sbp_lt_100: '近日最低收縮壓', hr_lt_50: '近日最低心跳', ecg_qtc: '近期 ECG QTc' };
const ROUTE_CODE_ZH = { oral: '口服', intravenous: '靜脈', intramuscular: '肌肉', subcutaneous: '皮下', inhalation: '吸入', topical: '外用', sublingual: '舌下', rectal: '肛門', enteral_tube: '管灌', transdermal: '貼片', ophthalmic: '眼用' };
function fieldZh(g) { const k = String(g.field || ''); if (g.field_zh && /[一-鿿]/.test(g.field_zh)) return g.field_zh; if (FIELD_ZH[k]) return FIELD_ZH[k]; const f = k.replace(/^fact_/, ''); return FACT_ZH[f] || FIELD_ZH[f] || '其他欄位'; }
const SEV_ZH = { critical: '高風險', act_today: '今日處理', review: '本次檢視', info: '資訊' };
function cardHtml(x, i) {
  const sub = (x.sub_items || []).length ? `<details><summary>另含 ${x.sub_items.length} 項相關問題</summary><ul>${x.sub_items.map((s) => `<li>${esc((s.drugs || []).join('、'))}：${esc(s.basis_zh || '')}${s.action_zh ? '；' + esc(s.action_zh) : ''}</li>`).join('')}</ul></details>` : '';
  const K = x.contract_v110 || {}, evz = { formal_source: '依據：已登錄正式來源', pending_source: '依據：正式來源待登錄（不作為唯一臨床依據）', not_indexed: '依據：未建立索引' }[K.evidence_status] || '';
  const facts = (K.triggering_facts || []).filter((f) => f.type === 'lab').map((f) => `${f.key} ${f.value}`).join('、');
  const src = x.source_zh || evz ? `<details><summary>依據來源${K.evidence_status === 'pending_source' ? '（待登錄）' : ''}</summary>${x.source_zh ? `<p>${esc(x.source_zh)}</p>` : ''}${evz ? `<p>${esc(evz)}</p>` : ''}${facts ? `<p>觸發檢驗值：${esc(facts)}</p>` : ''}${K.source_alignment ? `<p class="msg">${esc(K.source_alignment.source)}：${esc(K.source_alignment.note_zh)}</p>` : ''}<p class="muted">${esc(x.adjudication_zh)}</p></details>` : '';
  const teach = (S.me.perm === 'teacher' || S.me.perm === 'learner') && x.teaching ? `<details><summary>教學對應：${esc((x.teaching.epa || []).map((e) => e.id + ' ' + e.title_zh).join('、'))}</summary><ol>${(x.teaching.questions || []).map((q) => `<li>${esc(q.q_zh)}<div class="muted">${esc(q.answer_zh)}</div></li>`).join('')}</ol></details>` : '';
  return `<li class="card sev-${esc(x.severity_class)}">
    <div class="card-top"><span class="card-n">${i + 1}</span><span class="card-title">${esc(x.title_zh)}</span>
      <span class="badges"><span class="badge sev">${esc(SEV_ZH[x.severity_class] || x.severity_class)}</span><span class="badge ev">${esc(x.evidence)}</span>${x.tag_zh ? `<span class="badge">${esc(x.tag_zh)}</span>` : ''}</span></div>
    <p class="card-why">${esc(x.why_zh)}</p>
    <p class="card-act">${esc(x.action_zh)} <span class="owner">｜${esc(x.owner_zh)}｜${esc(x.when_zh)}</span></p>
    ${sub}${src}${teach}
    <div class="fb" role="group" aria-label="對第 ${i + 1} 項的回饋">
      <button type="button" data-fb="agree" data-rule="${esc(x.rule_id)}" aria-pressed="false">同意</button>
      <button type="button" data-fb="discuss" data-rule="${esc(x.rule_id)}" aria-pressed="false">需討論</button>
      <select aria-label="不同意理由" data-reason="${esc(x.rule_id)}"><option value="">不同意理由…</option><option value="NOT_CURRENT">已停用或未給藥</option><option value="INDICATION_OK">有適應症、已評估</option><option value="DATA_WRONG">資料或劑量判讀錯誤</option><option value="OTHER">其他</option></select>
      <button type="button" data-fb="disagree" data-rule="${esc(x.rule_id)}" aria-pressed="false">不同意</button>
    </div></li>`;
}
function renderResult() {
  const r = S.result, el = $('#result');
  if (r.learner_hidden && !r.learner_done) {
    el.innerHTML = `<div class="learner-gate"><h2>先作答，再看系統結果</h2><p class="muted">列出您判斷今天需要處理的藥（成分名或院內品名，每行一個）。送出後與系統今日卡比對。</p>
      <label class="field"><span>我的判斷</span><textarea id="learnAns" rows="5" style="min-height:120px"></textarea></label>
      <details class="panel" style="margin:12px 0"><summary>進階作答（選填，供教師評核六個面向；系統不評分）</summary>${LEARN_DIMS.map((d) => `<label class="field"><span>${d[1]}</span><textarea data-dim="${d[0]}" rows="2" maxlength="400"></textarea></label>`).join('')}</details>
      <div class="actions"><button type="button" class="primary" id="learnGo">送出並比對</button></div><p class="msg" id="learnMsg" role="status"></p></div>`;
    return;
  }
  const U = r.unevaluated, urg = r.urgency;
  let h = '';
  if (r.learner_cmp) h += `<div class="panel" style="margin-bottom:12px"><h2>作答比對</h2><p>找到 <b>${r.learner_cmp.found.length}</b>／${r.learner_cmp.today_total}；漏列 ${r.learner_cmp.missed.length}；多列 ${r.learner_cmp.extra.length}${r.learner_cmp.extra.length ? '（' + esc(r.learner_cmp.extra.join('、')) + '）' : ''}</p><p class="muted" id="cmpNote">${esc(r.learner_cmp.reference_zh || '比對對象為系統今日卡，系統結果為比較對象，非標準答案')}；「多列」不代表判斷錯誤，請與教師討論。</p></div>`;
  if (S.attest && !S.attest.ok) h += `<p class="attest-inline" role="note">部署版本未經驗證（${esc(S.attest.reasons.join('；'))}）：本結果只供測試。</p>`;
  if (urg) h += `<div class="urgency ${esc(urg.tier)}" role="status"><span>溝通急迫度：${esc(urg.zh)}</span><small>${esc(urg.basis_zh || '')}</small></div>`;
  const MI = (((r.tier1_shadow || {}).missing_inputs_v109 || {}).ask_user) || [];
  if (MI.length) h += `<div class="panel" style="margin-bottom:12px"><h2>補這些檢驗值，可多判定 ${MI.reduce((n, x) => n + x.unlocks.length, 0)} 項高風險情境</h2><ul>${MI.map((x) => `<li>${esc(x.input)}</li>`).join('')}</ul><p class="muted">未提供時，相關情境列為無法評估，不視為正常。</p></div>`;
  if (U.n) h += `<div class="unevaluated" role="alert"><b>未評估 ${U.n} 行：以下醫囑沒有進入評估，今日清單不完整。</b><ul>${U.lines.map((x) => `<li><span class="code">${esc(x.raw)}</span>　${esc(x.reason_zh)}</li>`).join('')}</ul></div>`;
  if (r.status !== 'ok') h += `<p class="msg">${esc(r.status_zh || '')}</p>`;
  const T3 = (r.top3_v110 || {}).items || [];
  if (T3.length > 1) h += `<div class="panel" style="margin-bottom:12px"><h2>今日優先三項</h2><ol>${T3.map((t) => `<li>${esc(t.title_zh)}　<span class="muted">${esc(SEV_ZH[t.severity_class] || t.severity_class)}${t.evidence_status === 'pending_source' ? '・依據待登錄' : ''}</span></li>`).join('')}</ol><p class="muted">${esc(r.top3_v110.basis_zh)}</p></div>`;
  h += `<div class="section-title"><h2>今日須處理</h2><span class="count">${r.today.length} 項${U.n ? '・清單不完整' : ''}</span></div>`;
  h += r.today.length ? `<ol class="cards">${r.today.map(cardHtml).join('')}</ol>` : '<p class="muted">本次沒有今日須處理的項目。</p>';
  if (r.review.length) h += `<div class="section-title"><h2>本次檢視</h2><span class="count">${r.review.length}／${r.review_total} 項</span></div><ol class="cards">${r.review.map((x, i) => cardHtml(x, i)).join('')}</ol>`;
  if ((r.demoted || []).length) h += `<details class="demoted"><summary>已依院方設定降級 ${r.demoted.length} 項（未刪除；展開檢視）</summary><ol class="cards">${r.demoted.map((x, i) => cardHtml(x, i).replace('<p class="card-why">', `<p class="muted">降級原因：${esc(x.demote_reason_zh || '')}</p><p class="card-why">`)).join('')}</ol></details>`;
  if (r.stabilize_v96 && r.stabilize_v96.source_hidden_n) h += `<p class="muted">${r.stabilize_v96.source_hidden_n} 項卡片之依據尚未登錄正式來源，已標「依據待登錄」。</p>`;
  if (r.gaps.length) h += `<div class="section-title"><h2>待補資料</h2><span class="count">補了會改變上面的判定</span></div><div class="gaps">${r.gaps.map((g) => `<span title="影響：${esc((g.for_items || []).join('、'))}">${esc(fieldZh(g))}</span>`).join('')}</div>`;
  h += `<div class="section-title"><h2>交班</h2><span class="count">${r.handoff.length} 行</span></div><div class="handoff" id="handoffText">${esc(r.handoff.join('\n'))}</div>
    <div class="handoff-actions"><button type="button" id="copyHandoff">複製交班</button><button type="button" id="copyDoctor">複製給醫師</button><button type="button" class="ghost" id="toBoard">到看板</button></div>`;
  if (r.policy_shadow_v104 && r.policy_shadow_v104.scope_note_zh) h += `<p class="muted" id="scopeNote">${esc(r.policy_shadow_v104.scope_note_zh)}</p>`;   // v10.4：不評估範圍固定一行（範圍契約第 3 層）
  h += `<p class="disclaimer">${esc(r.disclaimer_zh)}${r.persisted === false ? '　' + esc(r.persist_error_zh) : ''}</p>`;
  el.innerHTML = h;
}
function doctorText() {
  const r = S.result; const lines = [`【藥師用藥評估】${$('#f_alias').value}　急迫度：${r.urgency ? r.urgency.zh : '—'}`];
  if (r.unevaluated.n) lines.push(`未評估醫囑 ${r.unevaluated.n} 行（未納入下列，請今日確認）`);
  r.today.forEach((x, i) => lines.push(`${i + 1}. ${x.title_zh}：${x.why_zh}`, `   建議：${x.action_zh}`));   // v9.8 H0：不截斷（原 16 行上限會漏卡）
  return lines.join('\n');
}
async function copy(text, label) { try { await navigator.clipboard.writeText(text); live(`已複製${label}`); msg(`已複製${label}。`); } catch (e) { msg('瀏覽器不允許複製；請手動選取文字。', true); } }

// ── 儀表板
const fmtRate = (x) => (x && x.value != null ? `${x.value}<small>%</small>` : `<span class="muted" style="font-size:20px">${esc((x && x.display_zh) || '尚無資料')}</span>`);
const fmtNum = (v, unit) => (v == null ? '<span class="muted" style="font-size:20px">尚無資料</span>' : `${v}<small>${unit || ''}</small>`);
function spark(pts) { const v = (pts || []).filter((p) => p.value != null); if (v.length < 2) return ''; const lo = Math.min(...v.map((p) => p.value)), hi = Math.max(...v.map((p) => p.value)), W = 200, H = 28;
  const xy = v.map((p, i) => `${(i * W / (v.length - 1)).toFixed(1)},${(H - 3 - (hi === lo ? 11 : (p.value - lo) * (H - 6) / (hi - lo))).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="#0b4f8a" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`; }
function kpi(code, label, val, sub, sp) { return `<div class="kpi"><span class="k-code">${code}</span><div class="k-label">${label}</div><div class="k-val">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}${sp || ''}</div>`; }
async function loadDash() {
  const el = $('#dash'); el.setAttribute('aria-busy', 'true');
  const r = await api('dashboard', { days: $('#dashDays').value, unit: $('#dashUnit').value || '__all__' });
  el.removeAttribute('aria-busy');
  if (!r.ok) { el.innerHTML = `<p class="msg err">${esc(r.error_zh)}</p>`; return; }
  const c = r.clinical, p = r.process, t = r.teaching, k = r.filters.small_cell_k;
  $('#dashSub').textContent = `評估 ${r.n_encounters_display_zh} 次；分母小於 ${k} 不顯示數值；更新於 ${new Date(r.generated_at).toLocaleString('zh-TW', { hour12: false })}`;
  const hv = (x) => (x && x.value != null ? `${x.value}<small>%</small>` : `<small>${esc((x && x.display_zh) || '尚無資料')}</small>`);
  let h = `<div class="dash-hero" role="group" aria-label="本期摘要"><div><b>評估次數</b><span>${esc(r.n_encounters_display_zh)}</span></div><div><b>醫師採納今日卡</b><span>${hv(c.Q3_adopted)}</span></div><div><b>今日卡→醫師回覆中位數</b><span>${c.Q4_lead_h.median != null ? c.Q4_lead_h.median + '<small>小時</small>' : '<small>尚無資料</small>'}</span></div><div><b>學員找到今日卡</b><span>${hv(t.E1_found)}</span></div></div>`;
  h += '<h2 class="sr-only">臨床品質與流程</h2><div class="kpis">';
  h += kpi('P1', '品名辨識率', fmtRate(p.P1_resolved), p.P1_resolved.den ? `${p.P1_resolved.num ?? '—'}／${p.P1_resolved.den} 行` : '', spark(r.spc.P1.points));
  h += kpi('P2', '每日劑量計算率', fmtRate(p.P2_dose), p.P2_dose.den ? `${p.P2_dose.num ?? '—'}／${p.P2_dose.den} 行` : '', spark(r.spc.P2.points));
  h += kpi('Q2', '藥師同意今日卡', fmtRate(c.Q2_agree), '回饋中「同意」比例', spark(r.spc.Q2.points));
  h += kpi('Q3', '醫師採納', fmtRate(c.Q3_adopted), '含部分採納');
  h += kpi('Q4', '今日卡→醫師回覆', fmtNum(c.Q4_lead_h.median, ' 小時'), `中位數；n＝${c.Q4_lead_h.n}`);
  h += kpi('P4', '伺服器時間', fmtNum(p.P4_server_s.p50, ' 秒'), p.P4_server_s.p95 != null ? `p95 ${p.P4_server_s.p95} 秒` : '');
  h += kpi('Q5', '未評估醫囑行', fmtNum(c.Q5_unevaluated_lines.value, ' 行'), `有未評估之評估 ${c.Q5_unevaluated_lines.encounters_with} 次`);
  h += kpi('平衡', '今日卡／床', fmtNum(c.today_per_bed, ' 張'), '監測提示疲勞');
  h += '</div><div class="charts">';
  h += pchart(r.spc.P1, 'P1 品名辨識率（週）', '中心線為期間平均；虛線為 ±3σ 管制界限；圈起者為特殊原因。');
  h += pchart(r.spc.Q2, 'Q2 藥師同意今日卡（週）', '比例下降時，檢視該週今日卡是否為假警示。');
  h += cfdChart(r.cfd);
  h += heatTable(r.heatmap, k);
  h += '</div><h2 style="margin:8px 0 12px">教學成效（EPA5）</h2><div class="kpis">';
  h += kpi('E1', '學員找到今日卡', fmtRate(t.E1_found), '學員作答 vs 系統今日卡');
  h += kpi('E2', '學員多列', fmtRate(t.E2_extra), '列出但非今日卡');
  h += kpi('E4', '評核完成率', fmtRate(t.E4_rated), '已評核／已作答');
  h += kpi('E5', '回饋時效', fmtNum(t.E5_feedback_h.median, ' 小時'), `中位數；n＝${t.E5_feedback_h.n}`);
  h += `</div><div class="charts">${entrustChart(t.E3_entrustment, t.E3_n, k)}</div>`;
  if (r.test_excluded_encounters) h += `<p class="muted" role="note">已排除測試資料之評估 ${r.test_excluded_encounters} 次。</p>`;
  h += `<div class="notbuilt"><b>尚未建置之指標</b><ul>${r.not_built_zh.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div id="healthBox"></div>`;
  el.innerHTML = h;
}
function pchart(s, title, note) {
  const pts = (s && s.points) || [], W = 640, H = 240, L = 44, R = 12, T = 16, Bm = 40;
  const vals = pts.filter((p) => p.value != null);
  if (!vals.length) return `<figure class="chart"><h2>${esc(title)}</h2><p>資料不足（每週分母需達門檻）。</p></figure>`;
  const lo = Math.max(0, Math.min(...vals.map((p) => Math.min(p.value, p.lcl ?? p.value))) - 5), hi = Math.min(100, Math.max(...vals.map((p) => Math.max(p.value, p.ucl ?? p.value))) + 5);
  const x = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1)), y = (v) => T + (hi - v) * (H - T - Bm) / ((hi - lo) || 1);
  const path = (key) => pts.map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key])}`)).filter(Boolean);
  const line = pts.map((p, i) => (p.value == null ? null : [x(i), y(p.value)])).filter(Boolean);
  const grid = [lo, (lo + hi) / 2, hi].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="#e9eef3"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" font-size="13" fill="#55657a">${Math.round(g)}%</text>`).join('');
  const lbl = pts.map((p, i) => (i % Math.ceil(pts.length / 6) === 0 ? `<text x="${x(i)}" y="${H - 18}" text-anchor="middle" font-size="13" fill="#55657a">${esc(p.week.slice(5))}</text>` : '')).join('');
  const sp = pts.map((p, i) => (p.special && (p.special === 'outside_limits' || !(i > 0 && pts[i - 1].special === p.special)) ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="9" fill="none" stroke="#b42318" stroke-width="2"/><text x="${x(i)}" y="${y(p.value) - 13}" text-anchor="middle" font-size="13" font-weight="700" fill="#b42318">${p.special === 'outside_limits' ? '超界' : '連續 8 點同側'}</text>` : (p.special ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="9" fill="none" stroke="#b42318" stroke-width="2"/>` : ''))).join('');
  const aria = `${title}：中心線 ${s.center}%；` + vals.map((p) => `${p.week} ${p.value}%${p.special ? '（特殊原因）' : ''}`).join('；');
  return `<figure class="chart"><h2>${esc(title)}</h2><p>${esc(note)}</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${grid}
      <line x1="${L}" x2="${W - R}" y1="${y(s.center)}" y2="${y(s.center)}" stroke="#0b4f8a" stroke-width="1.5"/>
      <polyline points="${path('ucl').join(' ')}" fill="none" stroke="#8a4b00" stroke-dasharray="5 4"/><polyline points="${path('lcl').join(' ')}" fill="none" stroke="#8a4b00" stroke-dasharray="5 4"/>
      <polyline points="${line.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#142233" stroke-width="2"/>
      ${line.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#142233"/>`).join('')}${sp}${lbl}</svg>
    <div class="legend"><span><i style="background:#0b4f8a"></i>中心線 ${s.center}%</span><span><i style="background:#8a4b00"></i>管制界限</span><span><i style="background:#b42318"></i>特殊原因</span></div>
    <details><summary>以表格檢視</summary><table><thead><tr><th scope="col">週</th><th scope="col">分母</th><th scope="col">值</th><th scope="col">下限</th><th scope="col">上限</th><th scope="col">特殊原因</th></tr></thead><tbody>
    ${pts.map((p) => `<tr><td>${esc(p.week)}</td><td>${p.suppressed ? '＜門檻' : p.den}</td><td>${p.value ?? '—'}</td><td>${p.lcl ?? '—'}</td><td>${p.ucl ?? '—'}</td><td>${p.special ? (p.special === 'outside_limits' ? '超出管制界限' : '連續 8 點同側') : ''}</td></tr>`).join('')}</tbody></table></details></figure>`;
}
const KCOL = { queue: '#8fa3b8', today: '#b42318', advised: '#0b4f8a', replied: '#146c43', closed: '#c5cfda' };
function cfdChart(cfd) {
  if (!cfd || !cfd.length) return '<figure class="chart"><h2>看板流動（每日進入各欄次數）</h2><p>尚無看板資料。</p></figure>';
  const W = 640, H = 220, L = 32, Bm = 32, T = 12, cols = Object.keys(KCOL), max = Math.max(...cfd.map((d) => cols.reduce((a, c) => a + (d.counts[c] || 0), 0)), 1);
  const bw = Math.max(4, (W - L - 8) / cfd.length - 4);
  const bars = cfd.map((d, i) => { let acc = 0; return cols.map((c) => { const v = d.counts[c] || 0; if (!v) return ''; const hgt = v * (H - T - Bm) / max, y = H - Bm - acc - hgt; acc += hgt; return `<rect x="${L + i * (bw + 4)}" y="${y}" width="${bw}" height="${hgt}" fill="${KCOL[c]}"><title>${d.date} ${c} ${v}</title></rect>`; }).join(''); }).join('');
  return `<figure class="chart"><h2>看板流動（每日進入各欄次數）</h2><p>每日卡片移入各欄的次數；紅色持續偏高代表「今日須處理」堆積。</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="看板每日流動長條圖，共 ${cfd.length} 天">${bars}<line x1="${L}" x2="${W}" y1="${H - Bm}" y2="${H - Bm}" stroke="#d9e0e8"/></svg>
    <div class="legend">${cols.map((c) => `<span><i style="background:${KCOL[c]}"></i>${({ queue: '待評估', today: '今日須處理', advised: '已建議', replied: '醫師已回覆', closed: '結案' })[c]}</span>`).join('')}</div>
    <details><summary>以表格檢視</summary><table><thead><tr><th scope="col">日期</th>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${cfd.map((d) => `<tr><td>${d.date}</td>${cols.map((c) => `<td>${d.counts[c] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></details></figure>`;
}
function heatTable(hm, k) {
  if (!hm || !hm.length) return '<figure class="chart"><h2>今日卡規則 × 單位</h2><p>尚無資料。</p></figure>';
  const units = Array.from(new Set(hm.flatMap((r) => Object.keys(r.units)))).sort();
  const max = Math.max(1, ...hm.flatMap((r) => Object.values(r.units).filter((v) => v != null)));
  const cell = (v) => (v == null ? `<td class="n muted">＜${k}</td>` : `<td class="n" style="background:rgba(180,35,24,${(0.08 + 0.5 * v / max).toFixed(2)})">${v}</td>`);
  return `<figure class="chart"><h2>今日卡規則 × 單位</h2><p>次數小於 ${k} 不顯示。</p><div class="tbl-wrap"><table class="heat"><thead><tr><th scope="col">規則</th>${units.map((u) => `<th scope="col">${esc(u)}</th>`).join('')}</tr></thead><tbody>
    ${hm.map((r) => `<tr><th scope="row">${r.name_zh ? `${esc(r.name_zh)}<div class="code cf-sub">${esc(r.rule_id)}</div>` : `<span class="code">${esc(r.rule_id)}</span>`}</th>${units.map((u) => cell(r.units[u] ?? null)).join('')}</tr>`).join('')}</tbody></table></div></figure>`;
}
function entrustChart(e, n, k) {
  const levels = (S.me.epa5 && S.me.epa5.entrustment_levels) || [];
  if (!e) return `<figure class="chart"><h2>EPA5 單次觀察監督層級分布（非信賴決策）</h2><p>評核 ${n} 筆；少於 ${k} 筆不顯示分布。</p></figure>`;
  const max = Math.max(1, ...Object.values(e));
  return `<figure class="chart"><h2>EPA5 單次觀察監督層級分布（非信賴決策）</h2><p>評核 ${n} 筆。</p><div role="img" aria-label="${esc(levels.map((l) => `${l[0]} ${e[l[0]] || 0} 筆`).join('；'))}">
    ${levels.map((l) => `<div style="display:grid;grid-template-columns:48px 1fr 40px;gap:8px;align-items:center;margin:6px 0"><b>${esc(l[0])}</b><div class="track" style="height:14px;background:#e9eef3;border-radius:3px"><div style="height:100%;width:${100 * (e[l[0]] || 0) / max}%;background:#0b4f8a;border-radius:3px"></div></div><span>${e[l[0]] || 0}</span></div>`).join('')}</div>
    <details><summary>等級說明</summary><ul>${levels.map((l) => `<li>${esc(l[0])}：${esc(l[1])}</li>`).join('')}</ul></details></figure>`;
}
async function health() {
  const r = await api('admin_health', {}); const box = $('#healthBox'); if (!box) return;
  if (!r.ok) { box.innerHTML = `<p class="msg err">${esc(r.error_zh)}</p>`; return; }
  const sr = r.site_readiness || {}, o = await api('outcome_report', {});
  const om = o.ok ? `<h3>成效指標規格（控制台 44_成效指標規格，人工填寫）</h3><p>完整 ${o.spec_complete_n}／${o.total} 項</p><ul class="health">${o.measures.map((m) => `<li>${m.status === 'COMPUTED' ? '✅' : '⬜'} ${esc(m.row_key)}：${m.status === 'OUTCOME_SPEC_INCOMPLETE' ? '缺 ' + esc(m.missing_fields.join('、')) : esc(m.status)}</li>`).join('')}</ul>` : '';
  box.innerHTML = `<div class="panel" style="margin-top:16px"><h2>系統健康檢查</h2><p class="muted">版本 ${esc(r.version || '')}</p><ul class="health">${r.checks.map((c) => `<li>${c.ok ? '✅' : '❌'} ${esc(c.zh)}</li>`).join('')}</ul>
    <h3>院別就緒度：${esc(sr.state || '未知')}</h3>${(sr.missing || []).length ? `<ul class="health">${sr.missing.map((x) => `<li>⬜ ${esc(x)}</li>`).join('')}</ul>` : ''}${om}
    <h3>院內實測與影子期</h3><div class="row-actions"><button type="button" class="btn" id="btnPerf">院內效能自測（合成病例 20 次）</button><button type="button" class="btn" id="btnShadowRep">影子期報表（14 天）</button></div><div id="onsiteOut" aria-live="polite"></div></div>`;
  box.scrollIntoView({ block: 'start' });
}
// v10.8 W11：院內效能自測。只用固定合成醫囑，不經 record_result，不寫入評估紀錄
const PERF_CASES = [
  { alias: '效能自測A', order_lines: ['Warfarin 3 mg QD PO (自備)', 'Ciprofloxacin 500 mg BID PO (院內)', 'Amiodarone 200 mg QD PO (自備)'], patient: { age: '84', sex: 'F', scr_mg_dl: '1.4', weight_kg: '48' }, labs: { K: '3.4' } },
  { alias: '效能自測B', order_lines: ['Apixaban 5 mg BID PO (自備)', 'Ticagrelor 90 mg BID PO (院內)', 'Pantoprazole 40 mg QD PO (院內)', 'Lorazepam 1 mg HS PO (自備)'], patient: { age: '88', sex: 'M', scr_mg_dl: '2.1', weight_kg: '55' }, labs: {} },
  { alias: '效能自測C', order_lines: ['Metformin 500 mg BID PO (自備)', 'Spironolactone 25 mg QD PO (自備)', 'Valsartan 80 mg QD PO (自備)', 'Quetiapine 25 mg HS PO (院內)', 'Morphine 5 mg PRN IV (院內)'], patient: { age: '79', sex: 'F', scr_mg_dl: '1.8', weight_kg: '52' }, labs: { K: '5.6' } }];
const LEARN_DIMS = [['data', '依據的病史、用藥史與檢驗（EPA5 任務 1）'], ['drp', '找出的用藥相關問題（任務 2）'], ['evidence', '依據與本病人相符或不相符之處（任務 2、3）'], ['action', '建議計畫：做什麼、誰做、何時、監測什麼（任務 3）'], ['communication', '如何向醫療團隊說明（任務 4）'], ['followup', '之後追蹤與記錄什麼（任務 5）']];
async function perfSelfTest() {
  const out = $('#onsiteOut'); out.textContent = '執行中…';
  const e = await ensureEngine(); if (!e.ok) { out.textContent = '本機引擎無法啟動，無法自測：' + (e.error_zh || ''); return; }
  const t = [];
  for (let i = 0; i < 20; i++) { const c = PERF_CASES[i % PERF_CASES.length], t0 = performance.now(); const o = await engineCompute(Object.assign({ unit: '' }, c)); if (!o.rec) { out.textContent = '自測中斷：' + ((o.r && o.r.error_zh) || '引擎錯誤'); return; } t.push(performance.now() - t0); }
  t.sort((a, b) => a - b); const q = (f) => t[Math.min(t.length - 1, Math.ceil(f * t.length) - 1)];
  const r = await api('onsite_perf_record', { n: t.length, p50_ms: q(0.5), p95_ms: q(0.95), max_ms: t[t.length - 1], cores: navigator.hardwareConcurrency || 0, mem_gb: navigator.deviceMemory || 0, ua: navigator.userAgent });
  out.innerHTML = `<p>P50 ${Math.round(q(0.5))} 毫秒；P95 ${Math.round(q(0.95))} 毫秒；最大 ${Math.round(t[t.length - 1])} 毫秒（20 次）。${r.ok ? '已記錄於 45_院內實測。' + (r.meets_p95_10s ? 'P95 ≤10 秒。' : 'P95 超過 10 秒。') : '記錄失敗：' + esc(r.error_zh)}</p><p class="muted">合成病例本機引擎時間，不含 HIS 擷取與網路往返。</p>`;
}
async function shadowReport() {
  const out = $('#onsiteOut'), r = await api('shadow_period_report', { days: 14 });
  if (!r.ok) { out.innerHTML = `<p class="msg err">${esc(r.error_zh)}</p>`; return; }
  const kv = (o) => Object.keys(o || {}).map((x) => `${esc(x)}：${o[x] == null ? '＜' + r.small_cell_k : o[x]}`).join('；') || '無';
  out.innerHTML = `<p>近 ${r.days} 天：評估 ${r.encounters == null ? '＜' + r.small_cell_k : r.encounters} 次、床 ${r.beds == null ? '＜' + r.small_cell_k : r.beds}；今日卡／次 ${r.today_cards_per_encounter == null ? '—' : r.today_cards_per_encounter}；未評估醫囑行 ${r.unevaluated_lines}</p>
    <p>第 1 層影子觸發：${kv(r.tier1_shadow.fire_by_situation)}</p><p>第 1 層影子無法評估：${kv(r.tier1_shadow.not_evaluable_by_situation)}</p><p class="muted">${esc(r.note_zh)}</p>`;
}

// ── 教學
async function loadLearn() {
  const el = $('#learn'), m = S.me; let h = '<div class="learn-grid">';
  const mine = await api('my_learning', {});
  h += `<section class="panel"><h2>我的學習曲線</h2>${mine.ok && mine.answers.length ? lineChart(mine.answers) : '<p class="muted">尚無作答紀錄。學員在「病人評估」分析後會先作答。</p>'}
    ${mine.ok && mine.ratings.length ? `<h3 style="margin-top:12px">教師評核</h3><ul>${mine.ratings.map((x) => `<li>${new Date(x.at).toLocaleDateString('zh-TW')}：信賴等級 <b>${esc(x.entrustment)}</b></li>`).join('')}</ul>` : ''}</section>`;
  if (m.perm === 'teacher' || m.perm === 'admin') {
    const q = await api('teach_queue', {});
    h += `<section class="panel"><h2>待評核（EPA5 ${esc(m.epa5.title_zh)}）</h2>${q.ok && q.items.length ? `<ul class="queue">${q.items.map((it, i) => `<li><button type="button" data-rate="${i}"><span>${new Date(it.at).toLocaleString('zh-TW', { hour12: false })}・${esc(it.unit || '')}</span><span>找到 ${it.found}／漏 ${it.missed}／多 ${it.extra}</span></button></li>`).join('')}</ul>` : '<p class="muted">目前沒有待評核的學員作答。</p>'}
      <div id="epaForm"></div><p class="muted" style="margin-top:8px">${esc(m.epa5.source_zh || '')}</p>
      <div class="actions"><button type="button" class="btn ghost" id="btnCcc">CCC 縱貫彙整（下載 CSV；系統不做信賴決策）</button></div></section>`;
    S.teachQueue = q.items || [];
  }
  el.innerHTML = h + '</div>';
  const bc = document.getElementById('btnCcc'); if (bc) bc.addEventListener('click', async () => {
    const r = await api('ccc_export', {}); if (!r.ok) { live(r.error_zh || 'CCC 彙整失敗'); return; }
    const head = ['learner_pid', 'period_from', 'period_to', 'observations', 'assessors_n', 'contexts_n', 'wba_tools', 'supervision_levels_this_observation', 'learner_answers', 'data_sufficient_for_ccc_review', 'entrustment_decision'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [head.join(',')].concat(r.rows.map((x) => [x.learner_pid, x.period[0], x.period[1], x.observations, x.assessors_n, x.contexts_n, JSON.stringify(x.wba_tools), JSON.stringify(x.supervision_levels_this_observation), x.learner_answers, x.data_sufficient_for_ccc_review, '（CCC 人類審議）'].map(q).join(','))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'ccc_summary.csv'; a.click(); live('已下載 CCC 彙整（' + r.rows.length + ' 位）');
  });
}
function lineChart(a) {
  const W = 520, H = 180, L = 36, T = 12, Bm = 24, pts = a.filter((x) => x.rate != null);
  if (!pts.length) return '<p class="muted">尚無可計算之作答。</p>';
  const x = (i) => L + (pts.length === 1 ? (W - L - 12) / 2 : i * (W - L - 12) / (pts.length - 1)), y = (v) => T + (100 - v) * (H - T - Bm) / 100;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc('找到率：' + pts.map((p, i) => `第 ${i + 1} 案 ${p.rate}%`).join('；'))}">
    ${[0, 50, 100].map((g) => `<line x1="${L}" x2="${W - 12}" y1="${y(g)}" y2="${y(g)}" stroke="#e9eef3"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" font-size="13" fill="#55657a">${g}%</text>`).join('')}
    <polyline points="${pts.map((p, i) => `${x(i)},${y(p.rate)}`).join(' ')}" fill="none" stroke="#0b4f8a" stroke-width="2.5"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.rate)}" r="4" fill="#0b4f8a"/>`).join('')}</svg><p class="muted">第 n 案之今日卡找到率</p>`;
}
function epaForm(i) {
  const it = S.teachQueue[i], e = S.me.epa5;
  $('#epaForm').innerHTML = `<form class="epa-form panel" style="margin-top:12px" id="epaF"><h3>評核：${new Date(it.at).toLocaleString('zh-TW', { hour12: false })}</h3>
    ${Object.entries(e.tasks).map(([k, t]) => `<label class="field"><span>(${k}) ${esc(t)}</span><select data-task="${k}"><option value="">未選</option>${e.task_ratings.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>`).join('')}
    <label class="field"><span>本次觀察之監督層級（非信賴決策）*</span><select id="epaEnt" required><option value="">請選擇</option>${e.entrustment_levels.map((l) => `<option value="${esc(l[0])}">${esc(l[0])}｜${esc(l[1])}</option>`).join('')}</select></label>
    <label class="field"><span>評量工具 *</span><select id="epaTool" required><option value="">請選擇</option>${['mini-CEX', 'DOPS', 'CbD', '直接觀察'].map((t) => `<option>${t}</option>`).join('')}</select></label>
    <label class="field"><span>觀察情境（病房或情境，40 字內）</span><input id="epaCtx" maxlength="40"></label>
    <label class="field"><span>觀察到的行為證據 *（至少 10 字）</span><textarea id="epaEvi" rows="2" maxlength="500" required></textarea></label>
    <label class="field"><span>給學員的回饋 *（至少 10 字）</span><textarea id="epaFb" rows="2" maxlength="500" required></textarea></label>
    <label class="field"><span>教師審定答案（選填；成分英文名，以逗號分隔；學員作答將改與此比對）</span><input id="epaKey" maxlength="400"></label>
    <p class="muted">信賴等級之決定由 CCC 依多次、多位評核者、多情境之證據審議；單次觀察不構成信賴決策。</p>
    <div class="actions"><button type="submit" class="primary">送出評核</button></div><p class="msg" id="epaMsg" role="status"></p></form>`;
  $('#epaF').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const tasks = {}; $$('[data-task]').forEach((s) => { if (s.value) tasks[s.dataset.task] = s.value; });
    const key = $('#epaKey').value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
    if (key.length) { const k = await api('teach_key_set', { encounter_id: it.encounter_id, accepted: key }); if (!k.ok) { $('#epaMsg').textContent = k.error_zh; return; } }
    const r = await api('epa_rate', { encounter_id: it.encounter_id, learner_pid: it.learner_pid, entrustment: $('#epaEnt').value, tasks, wba_tool: $('#epaTool').value, context: $('#epaCtx').value, behavior_evidence: $('#epaEvi').value, feedback: $('#epaFb').value, });
    $('#epaMsg').textContent = r.ok ? '已送出。' + (r.observation_class_zh ? '紀錄類別：' + r.observation_class_zh : '') : r.error_zh; if (r.ok) setTimeout(loadLearn, 600);
  });
  $('#epaF select').focus();
}

// ── 事件
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.closest('#tabs')) { go(t.dataset.view); return; }
  if (t.id === 'signOut') { signOut('已登出。'); return; }
  if (t.id === 'sessExtend') { api('whoami', {}).then((r) => { if (r.ok) live('已延長登入。'); }); return; }
  if (t.id === 'reauthCancel') { closeReauth(false); return; }
  if (t.id === 'boardRefresh') { loadBoard(); return; }
  if (t.dataset.move) { move(t.closest('.kcard').dataset.key, t.dataset.move); return; }
  if (t.dataset.out) { move(t.closest('.kcard').dataset.key, 'replied', t.dataset.out); return; }
  if (t.dataset.open != null) { $('#f_alias').value = t.dataset.open; go('assess'); $('#f_orders').focus(); return; }
  if (t.id === 'btnParse') { parse(); return; }
  if (t.id === 'btnClear') { clearDraft(); $('#assessForm').reset(); $('#confirm').innerHTML = ''; $('#confirmWrap').hidden = true; $('#trust').innerHTML = ''; S.parse = null; S.result = null; $('#result').innerHTML = '<div class="empty"><p>貼上醫囑後按「分析」。</p></div>'; msg(''); $('#f_alias').focus(); return; }
  if (t.dataset.pick) { const [k, ci] = t.dataset.pick.split(':').map(Number); const c = S.parse.rows[k].candidates[ci]; replaceLine(k, c.pick_line); return; }
  if (t.dataset.bfgo != null) { const k = +t.dataset.bfgo, inp = $(`[data-bf="${k}"]`), ing = (inp.value || '').trim(); if (!ing) { inp.focus(); return; } const x = S.parse.rows[k]; replaceLine(k, `${ing} [藥師補登:${String(x.backfill.original_name || '').replace(/[[\]]/g, '')}] ${x.backfill.rest || ''}`.trim()); return; }
  if (t.dataset.fb) {
    const rule = t.dataset.rule, reason = t.dataset.fb === 'disagree' ? ($(`[data-reason="${CSS.escape(rule)}"]`, t.closest('.fb')) || {}).value : '';
    if (t.dataset.fb === 'disagree' && !reason) { msg('請先選不同意理由。', true); $(`[data-reason="${CSS.escape(rule)}"]`, t.closest('.fb')).focus(); return; }
    const r = await api('feedback', { encounter_id: S.result.encounter_id, rule_id: rule, decision: t.dataset.fb, reason_code: reason, req_id: rid() });
    if (r.ok) { $$('button[data-fb]', t.closest('.fb')).forEach((b) => b.setAttribute('aria-pressed', String(b === t))); live(`已記錄：${r.decision_zh}`); } else msg(r.error_zh, true);
    return;
  }
  if (t.id === 'copyHandoff') { copy(S.result.handoff.join('\n'), '交班'); return; }
  if (t.id === 'copyDoctor') { copy(doctorText(), '給醫師的建議'); return; }
  if (t.id === 'toBoard') { go('board'); return; }
  if (t.id === 'learnGo') {
    const ans = ($('#learnAns').value || '').split(/\r?\n|[,，、]/).map((x) => x.trim()).filter(Boolean);
    if (!ans.length) { $('#learnMsg').textContent = '請至少列出一項。'; return; }
    const dimensions = {}; $$('[data-dim]').forEach((x) => { if (x.value.trim()) dimensions[x.dataset.dim] = x.value.trim(); });
    const r = await api('learner_answer', { encounter_id: S.result.encounter_id, answers: ans, dimensions });
    if (!r.ok) { $('#learnMsg').textContent = r.error_zh; return; }
    S.result.learner_done = true; S.result.learner_cmp = r; renderResult(); live('已比對，顯示系統結果。'); return;
  }
  if (t.dataset.rate != null) { epaForm(+t.dataset.rate); return; }
  if (t.id === 'dashHealth') { health(); }
  if (t.id === 'btnPerf') { perfSelfTest(); return; }
  if (t.id === 'btnShadowRep') { shadowReport(); return; }
});
$('#assessForm').addEventListener('submit', analyze);
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const a = $('#addAlias').value.trim(); if (!a) return;
  if (phiScan(a).length || /\d{5,}/.test(a)) { alertMsg('化名不得含病歷號、身分證或長串數字。'); return; }
  const r = await api('kanban_add', { alias: a, unit: $('#boardUnit').value === '__all__' ? (S.me.unit || '') : $('#boardUnit').value });
  if (!r.ok) { alertMsg(r.error_zh); return; } $('#addAlias').value = ''; loadBoard();
});
['#boardUnit'].forEach((id) => $(id).addEventListener('change', loadBoard));
['#dashDays', '#dashUnit'].forEach((id) => $(id).addEventListener('change', loadDash));
let _dT = null; $('#assessForm').addEventListener('input', () => { clearTimeout(_dT); _dT = setTimeout(saveDraft, 400); });
$('#assessForm').addEventListener('change', saveDraft);
$('#f_orders').addEventListener('input', () => { if (S.parse && S.parse.text !== linesOf().join('\n')) { $('#trust').innerHTML = ''; } });
window.addEventListener('hashchange', () => { if (S.me) go(location.hash.replace('#', '')); });
window.addEventListener('beforeunload', (e) => { if ($('#f_orders').value.trim() && !S.result) { e.preventDefault(); e.returnValue = ''; } });

// v9.3：驗證既有登入期間隱藏 Google 登入鈕，避免誤按而多開一次登入；驗證失敗或登出時再顯示
function gsiVisible(on) { const b = $('#gsiButton'); if (b) b.style.display = on ? '' : 'none'; }
// v9.6 階段 I：部署實讀（後端回報值與本網站發布清單逐欄比對；不一致即紅色橫幅）
async function attestCheck() {
  const reasons = [], rel = S.release;
  const r = await api('attest', {});
  if (!rel) reasons.push('網站缺發布清單 assets/release.json');
  if (!r || r.ok === false) reasons.push('後端無法回報部署資訊');
  if (rel && FRONT_BUILD_ID !== rel.frontend_build_id) reasons.push('網站程式與發布清單不一致');
  if (rel && r && r.ok !== false) {
    if (r.build_id !== rel.code_build_id) reasons.push('後端程式不是本次發布版本');
    const fp = (r.rules || {})['BUILD_FINGERPRINT.json'] || {}, mf = (r.rules || {})['runtime_manifest_v1.json'] || {};
    if (fp.status !== 'ok' || fp.sha256 !== rel.rules['BUILD_FINGERPRINT.json']) reasons.push('雲端規則檔 BUILD_FINGERPRINT.json 不是本次發布版本');
    if (mf.status !== 'ok' || mf.sha256 !== rel.rules['runtime_manifest_v1.json']) reasons.push('雲端規則檔清單 runtime_manifest_v1.json 不是本次發布版本');
    if (fp.duplicate || mf.duplicate) reasons.push('雲端資料夾有同名重複檔');
  }
  S.attest = { ok: reasons.length === 0, reasons, raw: r };
  const b = $('#attestBanner');
  if (reasons.length) { b.hidden = false; b.textContent = `部署驗證未通過：${reasons.join('；')}。本頁只供測試，不得用於臨床。`; }
  else b.hidden = true;
  $('#build').textContent = `發布 ${rel ? rel.label : '—'}｜網站 ${FRONT_BUILD_ID.slice(0, 8)}｜後端 ${String(r && r.build_id || '—').slice(0, 8)}${reasons.length ? '（未驗證）' : '（已驗證）'}`;
}
(async function boot() {
  const ok = await loadConfig();
  if (!ok) { showSetupError(); return; }
  initGsi();
  let saved = null; try { saved = JSON.parse(store.get('anshin_v9_sess') || 'null'); } catch (e) { saved = null; }
  if (!sessValid(saved)) { gsiVisible(false); saved = await sessAskPeers(700); if (!sessValid(saved)) gsiVisible(true); }   // v9.2：本分頁無憑證 → 向其他已登入分頁索取
  if (sessValid(saved)) {
    gsiVisible(false); $('#loginMsg').textContent = '已登入，載入中…';
    S.session = saved; store.set('anshin_v9_sess', JSON.stringify(saved));
    let r = await api('whoami', {});
    // v9.2：網路中斷、後端冷啟動逾時、暫時忙碌 → 保留憑證並重試；只有後端明確判定無效才清除
    for (let k = 0; k < 2 && !r.ok && TRANSIENT_CODES.includes(r.error_code); k++) {
      $('#loginMsg').textContent = '正在連線後端…（登入仍有效）';
      await new Promise((ok) => setTimeout(ok, 3000 * (k + 1)));
      r = await api('whoami', {});
    }
    if (r.ok) { S.me = r; $('#loginMsg').textContent = ''; enterApp(); return; }
    if (TRANSIENT_CODES.includes(r.error_code)) {
      $('#loginMsg').textContent = '暫時無法連線後端；登入仍有效，請稍後重新整理頁面即可續用，不必重新登入。';
      return;
    }
    S.session = null; store.del('anshin_v9_sess'); gsiVisible(true);
    if (restoreDraft()) $('#loginMsg').textContent = '登入已逾時；重新登入後會還原剛才的輸入。';
    else if (!/^(SESSION_|TOKEN_)/.test(r.error_code || '') && r.error_zh) $('#loginMsg').textContent = r.error_zh;
  } else if (store.get(DRAFT_KEY)) { $('#loginMsg').textContent = '重新登入後會還原剛才的輸入。'; }
})();

// ── v10.0 HIS 零 token 帶入（藍圖 v21.1 §5）：院內 HIS 書籤 → postMessage／交換碼 → 自動填表；整病房分析與風險排序。病人資料只在本頁記憶體。
const HIS_ORIGINS = ['http://192.168.28.96'];
S.his = null; S.ward = [];
async function sha256Hex(str) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function hisValidate(pkt) {
  if (!pkt || !/^his_exchange_v[12]$/.test(pkt.schema || '') || !Array.isArray(pkt.patients) || !pkt.patients.length || pkt.patients.length > 80) return '交換包格式不符（schema 或病人數）';
  const integ = pkt.integrity || {};
  if (integ.sha256 !== await sha256Hex(JSON.stringify(pkt.patients))) return '交換包內容雜湊不符，已拒收（請重新擷取）';
  if (integ.n_patients !== pkt.patients.length) return '交換包病人數不符，已拒收';
  for (const p of pkt.patients) {
    if (!Array.isArray(p.orders) || p.orders.some((o) => typeof (o && o.raw) !== 'string')) return '交換包醫囑欄位不符';
    if (!Array.isArray(p.labs || [])) return '交換包檢驗欄位不符';
  }
  const phi = phiScan(JSON.stringify(pkt.patients.map((p) => [p.bed, p.unit, p.icd, (p.orders || []).map((o) => o.raw)])));
  if (phi.length) return `交換包含可識別資料（${phi.join('、')}），已拒收`;
  return null;
}
// 交換包 v1／v2 → 分析輸入。v2（藍圖 v22.0 P1）：逐項時間、序列、指尖血糖、生命徵象、表頭；由序列推導既有規則所需欄位（K／Na 異常持續天數、SCr 基線、最近 CBC 天數）
//@@HIS_ADAPTER_BEGIN（v10.2 藍圖 v23.0 W1：院別差異只來自 assets/site_profile.json；回放與驗收以此標記擷取同一段程式）
let SITE = null, SITE_LAB = {};
function siteApply(prof) {
  if (!prof || prof.schema !== 'site_profile_v1' || !prof.his || !prof.his.lab_item_map) { SITE = null; SITE_LAB = {}; return false; }
  SITE = prof; SITE_LAB = prof.his.lab_item_map; return true;
}
function hisToPayload(p) {
  if (!SITE) throw new Error('院別設定未載入，無法轉換 HIS 資料');
  const labs = {}, age = {}; let maxH = 0;
  const conv = (m, v) => { if (m.factor == null && m.round == null) return v; let x = Number(v); if (m.factor != null) x = x * m.factor; if (m.round != null) { const q = Math.pow(10, m.round); x = Math.round(x * q) / q; } return x; };
  const put = (k, v, h) => { if (v === '' || v == null || isNaN(Number(v))) return; labs[k] = String(v); if (h != null && !isNaN(Number(h))) { age[k] = Number(h); if (Number(h) > maxH) maxH = Number(h); } };
  const series = {};
  (p.labs || []).forEach((l) => { const m = SITE_LAB[l.item]; if (!m || l.value === '' || l.value == null || isNaN(Number(l.value))) return; const k = m.key; put(k, conv(m, l.value), l.h_ago);
    if (Array.isArray(l.series)) series[k] = l.series.filter((x) => x && !isNaN(Number(x.value))).map((x) => ({ v: conv(m, x.value), h: Number(x.h_ago) })); });
  // 指尖血糖（院別設定時窗內最低；單位換算同實驗室血糖）
  const gm = Object.values(SITE_LAB).find((m) => m.key === 'glu') || {};
  const pg = (p.poct_glucose || []).filter((x) => x && !isNaN(Number(x.value)) && Number(x.h_ago) <= (SITE.his.poct_glucose_window_h || 72)).map((x) => ({ value: conv(gm, x.value), h_ago: x.h_ago }));
  if (pg.length) { const m = pg.reduce((a, b) => (Number(b.value) < Number(a.value) ? b : a)); labs.poct_glu_min = String(m.value); labs.poct_glu_min_h_ago = String(m.h_ago); }
  // 生命徵象
  const vs = p.vitals || {};
  const vmin = (arr) => { const a = (arr || []).filter((x) => x && !isNaN(Number(x.value))); return a.length ? a.reduce((x, y) => (Number(y.value) < Number(x.value) ? y : x)) : null; };
  const sb = vmin(vs.sbp), hr = vmin(vs.hr); if (sb) put('sbp_min', sb.value, sb.h_ago); if (hr) put('hr_min', hr.value, hr.h_ago);
  const vmax = (arr) => { const a = (arr || []).filter((x) => x && !isNaN(Number(x.value))); return a.length ? a.reduce((x, y) => (Number(y.value) > Number(x.value) ? y : x)) : null; };   // v11.1：體溫取最高（發燒情境）
  const tp = vmax(vs.temp); if (tp) put('temp_max', tp.value, tp.h_ago);
  // 序列推導
  const since = (k, abn) => { const sr = (series[k] || []).slice().sort((a, b) => a.h - b.h); if (!sr.length || !abn(sr[0].v)) return null; let h = sr[0].h; for (const x of sr) { if (!abn(x.v)) break; h = x.h; } return Math.round(h / 24 * 10) / 10; };
  const rr = SITE.reference_ranges || {}, out = (k) => (rr[k] ? (v) => v < rr[k][0] || v > rr[k][1] : null);
  const kS = out('K') ? since('K', out('K')) : null, nS = out('Na') ? since('Na', out('Na')) : null;
  if (kS != null) labs.k_abnormal_since_days = String(kS); if (nS != null) labs.na_abnormal_since_days = String(nS);
  const cr = (series.scr || []).filter((x) => x.h > 24).sort((a, b) => a.v - b.v)[0];
  if (cr) { labs.scr_baseline = String(cr.v); labs.scr_baseline_hours_ago = String(cr.h); }
  // v10.3：Hb 48 小時內最大降幅（ISTH 主要出血定義之 Hb 條件；第 1 層影子 T1-07a）
  const hbS = (series.Hb || []).filter((x) => !isNaN(x.h)).sort((a, b) => a.h - b.h);
  if (hbS.length >= 2) { const last = hbS[0], prior = hbS.filter((x) => x.h > last.h && x.h - last.h <= 48);
    if (prior.length) { const mx = prior.reduce((a, b) => (b.v > a.v ? b : a)); labs.hb_drop_48h = String(Math.round((mx.v - last.v) * 10) / 10); labs.hb_drop_window_h = String(mx.h - last.h); } }
  const cbcH = ['PLT', 'Hb', 'WBC'].map((k) => age[k]).filter((x) => x != null);
  if (cbcH.length) labs.last_cbc_days_ago = String(Math.round(Math.min(...cbcH) / 24 * 10) / 10);
  if (Object.keys(age).length) labs.lab_days_ago = String(Math.ceil(maxH / 24));
  const scrV = labs.scr; delete labs.scr; const scrH = age.scr; delete age.scr;
  const bed = String(p.bed || '').replace(/[^0-9A-Za-z]/g, '');
  return { alias: String(p.alias || (bed ? 'R-' + bed : '')).slice(0, 16), unit: String(p.unit || '').slice(0, 30), admission_day: p.admission_day != null ? String(p.admission_day) : '',
    icd: (p.icd || []).join(' '), labs, labs_age_h: Object.assign(age, scrH != null ? { scr: scrH } : {}), flags: {}, order_lines: (p.orders || []).map((o) => o.raw).filter((x) => x.trim()),
    order_flags_v2: (p.orders || []).map((o) => (o.flags || []).join(',')),
    patient: { age: p.age != null ? String(p.age) : '', sex: p.sex || '', weight_kg: p.weight_kg != null ? String(p.weight_kg) : '',
      scr_mg_dl: scrV != null ? scrV : (p.scr_mg_dl != null ? String(p.scr_mg_dl) : ''), scr_days_ago: scrH != null ? String(Math.round(scrH / 24 * 10) / 10) : (p.scr_h_ago != null ? String(Math.ceil(Number(p.scr_h_ago) / 24)) : ''), dialysis: p.dialysis === true } };
}
//@@HIS_ADAPTER_END
async function loadSite() {   // 雜湊須與 release.json site_profile_sha256 相符，否則停用 HIS 帶入（fail-closed）
  try { const r = await fetch('assets/site_profile.json', { cache: 'no-store' }); const txt = r.ok ? await r.text() : '';
    const want = S.release && S.release.site_profile_sha256; const got = txt ? await sha256Hex(txt) : '';
    if (!txt || !want || got !== want) { siteApply(null); S.siteError = '院別設定檔缺漏或雜湊不符，HIS 帶入已停用'; return; }
    siteApply(JSON.parse(txt)); S.siteError = null; const n = document.getElementById('hisSysName'); if (n && SITE.his.system) n.textContent = SITE.his.system; } catch (e) { siteApply(null); S.siteError = '院別設定檔讀取失敗，HIS 帶入已停用'; } }
function hisFill(d) {
  const set = (id, v, ageH) => { const el = typeof id === 'string' ? $(id) : id; if (!el) return; el.value = v == null ? '' : v; el.classList.toggle('src-his', v !== '' && v != null); el.dataset.src = v !== '' && v != null ? 'his' : ''; el.dataset.ageH = ageH != null ? String(ageH) : ''; el.title = ageH != null ? 'HIS 帶入（' + (ageH < 48 ? Math.round(ageH) + ' 小時前' : Math.round(ageH / 24) + ' 天前') + '）' : ''; };
  set('#f_alias', d.alias); set('#f_unit', d.unit); set('#f_adm', d.admission_day); set('#f_age', d.patient.age); set('#f_sex', d.patient.sex); set('#f_wt', d.patient.weight_kg);
  set('#f_scr', d.patient.scr_mg_dl, (d.labs_age_h || {}).scr); set('#f_scr_ago', d.patient.scr_days_ago); $('#f_dialysis').checked = d.patient.dialysis; set('#f_icd', d.icd);
  $$('[data-lab]').forEach((el) => set(el, d.labs[el.dataset.lab], (d.labs_age_h || {})[el.dataset.lab]));
  $('#f_orders').value = d.order_lines.join('\n'); $('#f_orders').classList.add('src-his'); S.parse = null;
}
document.addEventListener('input', (e) => { if (e.target && e.target.dataset && e.target.dataset.src === 'his') { e.target.dataset.src = 'manual'; e.target.dataset.ageH = ''; e.target.title = '人工修改'; e.target.classList.remove('src-his'); e.target.classList.add('src-manual'); } });
async function hisAccept(pkt) {
  const err = (!SITE ? (S.siteError || '院別設定未載入，HIS 帶入已停用') : null) || await hisValidate(pkt), m = $('#hisMsg');
  if (err) { m.textContent = err; m.classList.add('err'); return { ok: false, error: err }; }
  m.classList.remove('err'); S.his = pkt;
  if (pkt.patients.length === 1) { hisFill(hisToPayload(pkt.patients[0])); m.textContent = `已帶入 1 位（${pkt.patients[0].orders.length} 行醫囑）。請檢查標示「HIS」之欄位後送出。`; $('#btnWardRun').hidden = true; $('#wardQueue').innerHTML = ''; }
  else { S.ward = pkt.patients.map((p) => ({ p, d: hisToPayload(p), r: null })); renderWard(); $('#btnWardRun').hidden = false; m.textContent = `已帶入 ${pkt.patients.length} 位。可按「整病房分析」。`; }
  return { ok: true, n: pkt.patients.length };
}
const SEV_RANK = { critical: 4, act_today: 3, review: 2, info: 1 };
function wardScore(r) { if (!r || !r.ok) return -1; const ue = r.unevaluated && r.unevaluated.n ? r.unevaluated.n : 0; const top = Math.max(0, ...r.today.map((x) => SEV_RANK[x.severity_class] || 0)); return r.today.length * 1e6 + (r.review || []).length * 1e3 + Math.min(ue, 99) * 10 + top; }   // v10.4：今日卡數 → 檢視卡數 → 未能評估數（藍圖 v22.0 §4）
function renderWard() {
  const rows = S.ward.map((w, i) => ({ w, i })).sort((a, b) => wardScore(b.w.r) - wardScore(a.w.r));
  $('#wardQueue').innerHTML = `<div class="tbl-wrap"><table><caption>病房佇列（已分析者依風險排序：最高嚴重度 → 今日卡數 → 未評估行數）</caption>
    <thead><tr><th scope="col">化名</th><th scope="col">醫囑行</th><th scope="col">今日卡</th><th scope="col">最高</th><th scope="col">未評估</th><th scope="col">動作</th></tr></thead><tbody>${rows.map(({ w, i }) => {
      const r = w.r, top = r && r.ok ? (r.today[0] ? (SEV_ZH[r.today.slice().sort((a, b) => (SEV_RANK[b.severity_class] || 0) - (SEV_RANK[a.severity_class] || 0))[0].severity_class] || '') : '無') : (r ? '失敗' : '未分析');
      return `<tr><td>${esc(w.d.alias)}</td><td>${w.d.order_lines.length}</td><td>${r && r.ok ? r.today.length : '—'}</td><td>${esc(top)}</td><td>${r && r.ok && r.unevaluated ? r.unevaluated.n : '—'}</td>
        <td><button type="button" class="btn" data-ward="${i}">${r && r.ok ? '開啟結果' : '帶入表單'}</button></td></tr>`; }).join('')}</tbody></table></div>`;
}
$('#wardQueue').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ward]'); if (!b) return; const w = S.ward[Number(b.dataset.ward)];
  hisFill(w.d); if (w.r && w.r.ok) { S.result = w.r; renderResult(); $('#result').scrollIntoView({ block: 'start' }); }
});
$('#btnWardRun').addEventListener('click', async () => {
  const m = $('#hisMsg'), e = await ensureEngine();
  if (!e.ok) { m.textContent = '整病房分析需要本機引擎：' + (e.error_zh || '無法啟用'); m.classList.add('err'); return; }
  const btn = $('#btnWardRun'); btn.disabled = true; const t0 = Date.now();
  const recs = [];
  for (let i = 0; i < S.ward.length; i++) { m.textContent = `本機判讀 ${i + 1}／${S.ward.length}…`; const o = await engineCompute(S.ward[i].d); S.ward[i].r = o.r; if (o.rec) recs.push({ i, rec: o.rec }); renderWard(); }
  const t1 = Date.now(); m.textContent = `判讀完成（${Math.round((t1 - t0) / 1000)} 秒），寫回紀錄中…`;
  for (let k = 0; k < recs.length; k += 20) {   // R14-12：每 20 床一次寫回
    const part = recs.slice(k, k + 20), rr = await api('record_results', { items: part.map((x) => { x.rec.req_id = x.rec.req_id || rid(); return x.rec; }) });
    part.forEach((x, j) => { const r = S.ward[x.i].r, it = rr.ok && rr.items ? rr.items[j] : null;
      if (it && it.ok !== false) { r.encounter_id = it.encounter_id; r.case_key = it.case_key; r.persisted = it.persisted; r.persist_error_zh = it.persist_error_zh; r.events_persist_error_zh = it.events_persist_error_zh; }
      else { r.persisted = false; r.persist_error_zh = '紀錄未保存：' + ((it && it.error_zh) || rr.error_zh || '後端未回應'); } });
  }
  const bad = S.ward.filter((w) => w.r && w.r.persisted === false).length;
  btn.disabled = false; renderWard(); m.textContent = `完成 ${S.ward.length} 位（判讀 ${Math.round((t1 - t0) / 1000)} 秒、寫回 ${Math.round((Date.now() - t1) / 1000)} 秒）。已依風險排序${bad ? `；${bad} 位紀錄未保存` : '；結果已記錄於看板'}。`;
});
$('#btnHisPaste').addEventListener('click', async () => {
  const t = $('#hisCode').value.trim(), m = $('#hisMsg'); let pkt = null;
  try { if (!/^ANSHIN1:/.test(t)) throw new Error(); pkt = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.slice(8)), (c) => c.charCodeAt(0)))); } catch (e) { m.textContent = '交換碼格式不符（應以 ANSHIN1: 開頭）'; m.classList.add('err'); return; }
  await hisAccept(pkt); $('#hisCode').value = '';
});
window.addEventListener('message', async (e) => {
  if (HIS_ORIGINS.indexOf(e.origin) < 0 || !e.data || e.data.type !== 'anshin_his_v1') return;
  const r = S.me ? await hisAccept(e.data.packet) : { ok: false, error: '請先登入安心桃選' };
  try { e.source.postMessage({ type: 'anshin_his_ack', ok: r.ok, n: r.n || 0, error: r.error || null }, e.origin); } catch (x) {}
});
