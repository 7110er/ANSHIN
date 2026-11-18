// 安心桃選 v10.0｜本機引擎 Web Worker：解密引擎包 → 驗證 → 載入 Code.gs → 判讀。明文只存在本 Worker 記憶體。
/* global AnshinEngineEnv */
'use strict';
importScripts('engine-env.js');
var READY = null;
function fail(code, zh) { return { ok: false, error_code: code, error_zh: zh }; }
function hex(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16); return s; }
async function gunzip(u8) {
  var ds = new DecompressionStream('gzip'), w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function init(m) {
  var t0 = Date.now(), raw = new Uint8Array(m.cipher);
  if (hex(await crypto.subtle.digest('SHA-256', raw)) !== m.sha_cipher) return fail('PACK_HASH', '引擎包雜湊不符，已停止（請重新整理；仍失敗請回報維護者）');
  var key, plain;
  try { key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(m.key_b64), function (c) { return c.charCodeAt(0); }), { name: 'AES-GCM' }, false, ['decrypt']); }
  catch (e) { return fail('PACK_KEY_INVALID', '引擎金鑰格式不符'); }
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12))); }
  catch (e) { return fail('PACK_DECRYPT', '引擎包解密失敗（金鑰與網站版本不一致）'); }
  var json = await gunzip(plain);
  if (hex(await crypto.subtle.digest('SHA-256', json)) !== m.sha_plain) return fail('PACK_PLAIN_HASH', '引擎包內容雜湊不符，已停止');
  var pack = JSON.parse(new TextDecoder('utf-8').decode(json)); json = null; plain = null;
  if (pack.schema !== 'anshin_engine_pack_v1') return fail('PACK_SCHEMA', '引擎包格式不符');
  var svc = AnshinEngineEnv.makeServices(pack.files, {});
  Object.keys(svc).forEach(function (k) { self[k] = svc[k]; });
  try { (0, eval)(pack.code); } catch (e) { return fail('ENGINE_LOAD', '引擎載入失敗：' + String(e && e.message || e).slice(0, 120)); }
  pack.code = null;
  if (self.ANSHIN_V96_BUILD_ID_ !== m.code_build_id) return fail('ENGINE_BUILD', '引擎包版本與發布清單不符，已停止');
  try { self.anshinV10LocalIdentity_(m.role_code); } catch (e) { return fail('ENGINE_ROLE', '角色代碼無法用於本機引擎：' + String(e && e.message || e).slice(0, 80)); }
  READY = { build: self.ANSHIN_V96_BUILD_ID_, files: Object.keys(pack.files).length };
  return { ok: true, build: READY.build, files: READY.files, init_ms: Date.now() - t0 };
}
function run(m) {
  if (!READY) return fail('ENGINE_NOT_READY', '本機引擎尚未就緒');
  var ctx = m.ctx || {};
  try {
    if (m.cmd === 'parse') return self.anshinV9Parse_(m.payload || {}, ctx);
    if (m.cmd === 'analyze') { var t = Date.now(), c = self.anshinV9Compute_(m.payload || {}, ctx);
      if (!c || c.ok === false) return c;
      c.er.timing_v99 = c.er.timing_v99 || {}; c.er.timing_v99.worker_ms = Date.now() - t;
      return { ok: true, er: c.er, counts: c.counts, events: c.events || {} }; }
  } catch (e) { return fail('ENGINE_ERROR', '本機引擎執行錯誤：' + String(e && e.message || e).slice(0, 160)); }
  return fail('BAD_CMD', '未知指令');
}
self.onmessage = async function (ev) {
  var m = ev.data || {}, out;
  try { out = m.cmd === 'init' ? await init(m) : run(m); } catch (e) { out = fail('ENGINE_ERROR', String(e && e.message || e).slice(0, 160)); }
  self.postMessage({ id: m.id, out: out });
};
