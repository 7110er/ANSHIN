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
const FRONT_BUILD_ID = '9a724dcd02c14bed09539798920058e962a33430ec480c7b3f5b204dc086270f';
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
async function loadRelease() { try { const r = await fetch('assets/release.json', { cache: 'no-store' }); S.release = r.ok ? await r.json() : null; } catch (e) { S.release = null; } }
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
const RETRY_SAFE = ['whoami', 'kanban_list', 'dashboard', 'my_learning', 'teach_queue', 'parse'];
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
    </section>`;
  }).join('');
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
    <div class="k-top"><span class="alias">${esc(k.alias)}</span>${k.is_test ? '<span class="badge">測試</span>' : ''}<span class="meta">${esc(k.unit || '')}</span></div>
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
  const labs = {}; $$('[data-lab]').forEach((el) => { if (el.value !== '') labs[el.dataset.lab] = el.value; });
  const flags = {}; $$('[data-flag]').forEach((el) => { if (el.checked) flags[el.dataset.flag] = true; });
  return { alias: v('#f_alias'), unit: v('#f_unit'), admission_day: v('#f_adm'), icd: v('#f_icd'), labs, flags, order_lines: linesOf(),
           patient: { age: v('#f_age'), sex: v('#f_sex'), weight_kg: v('#f_wt'), scr_mg_dl: v('#f_scr'), scr_days_ago: v('#f_scr_ago'), dialysis: $('#f_dialysis').checked } };
}
function msg(t, err) { const m = $('#assessMsg'); m.textContent = t || ''; m.classList.toggle('err', !!err); if (t) live(t); }
async function parse() {
  const lines = linesOf();
  if (!lines.length) { msg('請先貼上醫囑。', true); $('#f_orders').focus(); return null; }
  const phi = phiScan(lines.join('\n')); if (phi.length) { msg(`醫囑含可識別資料（${phi.join('、')}），請刪除後再送出。`, true); return null; }
  msg('逐行辨識中…');
  const r = await api('parse', { order_lines: lines });
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
  const tick = setInterval(() => msg(`分析中…已 ${Math.round((Date.now() - t0) / 1000)} 秒（正式站目前每床約 3–5 分鐘；效能改善尚未完成）`), 1000);
  const r = await api('analyze', d);
  clearInterval(tick); btn.disabled = false;
  if (!r.ok) { msg(r.error_zh, true); return; }
  S.result = r; msg(`完成：今日須處理 ${r.today.length} 項${r.unevaluated.n ? `；未評估 ${r.unevaluated.n} 行` : ''}。`);
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
  const src = x.source_zh ? `<details><summary>依據來源</summary><p>${esc(x.source_zh)}</p><p class="muted">${esc(x.adjudication_zh)}</p></details>` : '';
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
      <div class="actions"><button type="button" class="primary" id="learnGo">送出並比對</button></div><p class="msg" id="learnMsg" role="status"></p></div>`;
    return;
  }
  const U = r.unevaluated, urg = r.urgency;
  let h = '';
  if (r.learner_cmp) h += `<div class="panel" style="margin-bottom:12px"><h2>作答比對</h2><p>找到 <b>${r.learner_cmp.found.length}</b>／${r.learner_cmp.today_total}；漏列 ${r.learner_cmp.missed.length}；多列 ${r.learner_cmp.extra.length}${r.learner_cmp.extra.length ? '（' + esc(r.learner_cmp.extra.join('、')) + '）' : ''}</p></div>`;
  if (S.attest && !S.attest.ok) h += `<p class="attest-inline" role="note">部署版本未經驗證（${esc(S.attest.reasons.join('；'))}）：本結果只供測試。</p>`;
  if (urg) h += `<div class="urgency ${esc(urg.tier)}" role="status"><span>溝通急迫度：${esc(urg.zh)}</span><small>${esc(urg.basis_zh || '')}</small></div>`;
  if (U.n) h += `<div class="unevaluated" role="alert"><b>未評估 ${U.n} 行：以下醫囑沒有進入評估，今日清單不完整。</b><ul>${U.lines.map((x) => `<li><span class="code">${esc(x.raw)}</span>　${esc(x.reason_zh)}</li>`).join('')}</ul></div>`;
  if (r.status !== 'ok') h += `<p class="msg">${esc(r.status_zh || '')}</p>`;
  h += `<div class="section-title"><h2>今日須處理</h2><span class="count">${r.today.length} 項${U.n ? '・清單不完整' : ''}</span></div>`;
  h += r.today.length ? `<ol class="cards">${r.today.map(cardHtml).join('')}</ol>` : '<p class="muted">本次沒有今日須處理的項目。</p>';
  if (r.review.length) h += `<div class="section-title"><h2>本次檢視</h2><span class="count">${r.review.length}／${r.review_total} 項</span></div><ol class="cards">${r.review.map((x, i) => cardHtml(x, i)).join('')}</ol>`;
  if ((r.demoted || []).length) h += `<details class="demoted"><summary>已依院方設定降級 ${r.demoted.length} 項（未刪除；展開檢視）</summary><ol class="cards">${r.demoted.map((x, i) => cardHtml(x, i).replace('<p class="card-why">', `<p class="muted">降級原因：${esc(x.demote_reason_zh || '')}</p><p class="card-why">`)).join('')}</ol></details>`;
  if (r.stabilize_v96 && r.stabilize_v96.source_hidden_n) h += `<p class="muted">${r.stabilize_v96.source_hidden_n} 項卡片之依據尚未登錄正式來源，已標「依據待登錄」。</p>`;
  if (r.gaps.length) h += `<div class="section-title"><h2>待補資料</h2><span class="count">補了會改變上面的判定</span></div><div class="gaps">${r.gaps.map((g) => `<span title="影響：${esc((g.for_items || []).join('、'))}">${esc(fieldZh(g))}</span>`).join('')}</div>`;
  h += `<div class="section-title"><h2>交班</h2><span class="count">${r.handoff.length} 行</span></div><div class="handoff" id="handoffText">${esc(r.handoff.join('\n'))}</div>
    <div class="handoff-actions"><button type="button" id="copyHandoff">複製交班</button><button type="button" id="copyDoctor">複製給醫師</button><button type="button" class="ghost" id="toBoard">到看板</button></div>`;
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
  if (!e) return `<figure class="chart"><h2>EPA5 信賴等級分布</h2><p>評核 ${n} 筆；少於 ${k} 筆不顯示分布。</p></figure>`;
  const max = Math.max(1, ...Object.values(e));
  return `<figure class="chart"><h2>EPA5 信賴等級分布</h2><p>評核 ${n} 筆。</p><div role="img" aria-label="${esc(levels.map((l) => `${l[0]} ${e[l[0]] || 0} 筆`).join('；'))}">
    ${levels.map((l) => `<div style="display:grid;grid-template-columns:48px 1fr 40px;gap:8px;align-items:center;margin:6px 0"><b>${esc(l[0])}</b><div class="track" style="height:14px;background:#e9eef3;border-radius:3px"><div style="height:100%;width:${100 * (e[l[0]] || 0) / max}%;background:#0b4f8a;border-radius:3px"></div></div><span>${e[l[0]] || 0}</span></div>`).join('')}</div>
    <details><summary>等級說明</summary><ul>${levels.map((l) => `<li>${esc(l[0])}：${esc(l[1])}</li>`).join('')}</ul></details></figure>`;
}
async function health() {
  const r = await api('admin_health', {}); const box = $('#healthBox'); if (!box) return;
  box.innerHTML = r.ok ? `<div class="panel" style="margin-top:16px"><h2>系統健康檢查</h2><ul class="health">${r.checks.map((c) => `<li>${c.ok ? '✅' : '❌'} ${esc(c.zh)}</li>`).join('')}</ul></div>` : `<p class="msg err">${esc(r.error_zh)}</p>`;
  box.scrollIntoView({ block: 'start' });
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
      <div id="epaForm"></div><p class="muted" style="margin-top:8px">${esc(m.epa5.source_zh || '')}</p></section>`;
    S.teachQueue = q.items || [];
  }
  el.innerHTML = h + '</div>';
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
    <label class="field"><span>整體信賴等級 *</span><select id="epaEnt" required><option value="">請選擇</option>${e.entrustment_levels.map((l) => `<option value="${esc(l[0])}">${esc(l[0])}｜${esc(l[1])}</option>`).join('')}</select></label>
    <div class="actions"><button type="submit" class="primary">送出評核</button></div><p class="msg" id="epaMsg" role="status"></p></form>`;
  $('#epaF').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const tasks = {}; $$('[data-task]').forEach((s) => { if (s.value) tasks[s.dataset.task] = s.value; });
    const r = await api('epa_rate', { encounter_id: it.encounter_id, learner_pid: it.learner_pid, entrustment: $('#epaEnt').value, tasks });
    $('#epaMsg').textContent = r.ok ? '已送出。' : r.error_zh; if (r.ok) setTimeout(loadLearn, 600);
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
    const r = await api('feedback', { encounter_id: S.result.encounter_id, rule_id: rule, decision: t.dataset.fb, reason_code: reason });
    if (r.ok) { $$('button[data-fb]', t.closest('.fb')).forEach((b) => b.setAttribute('aria-pressed', String(b === t))); live(`已記錄：${r.decision_zh}`); } else msg(r.error_zh, true);
    return;
  }
  if (t.id === 'copyHandoff') { copy(S.result.handoff.join('\n'), '交班'); return; }
  if (t.id === 'copyDoctor') { copy(doctorText(), '給醫師的建議'); return; }
  if (t.id === 'toBoard') { go('board'); return; }
  if (t.id === 'learnGo') {
    const ans = ($('#learnAns').value || '').split(/\r?\n|[,，、]/).map((x) => x.trim()).filter(Boolean);
    if (!ans.length) { $('#learnMsg').textContent = '請至少列出一項。'; return; }
    const r = await api('learner_answer', { encounter_id: S.result.encounter_id, answers: ans });
    if (!r.ok) { $('#learnMsg').textContent = r.error_zh; return; }
    S.result.learner_done = true; S.result.learner_cmp = r; renderResult(); live('已比對，顯示系統結果。'); return;
  }
  if (t.dataset.rate != null) { epaForm(+t.dataset.rate); return; }
  if (t.id === 'dashHealth') { health(); }
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
