// 安心桃選 v10.0｜本機引擎可攜層（瀏覽器 Web Worker 與 Node 測試共用）。
// 以「引擎包」內之規則檔模擬 Apps Script 服務，讓同一份 Code.gs 在瀏覽器執行判讀；不含任何試算表、金鑰或鹽。
// 規則檔仍經 Code.gs 內既有 manifest 逐檔 SHA-256 驗證（不放寬）。
(function (root) {
  'use strict';
  // ── 同步 SHA-256（FIPS 180-4）與 HMAC-SHA256；輸入為位元組陣列（0–255）
  var K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256Bytes(msg) {
    var n = msg.length, bitLenHi = Math.floor(n / 0x20000000), bitLenLo = (n * 8) >>> 0;
    var padLen = ((n + 9 + 63) >> 6) << 6, buf = new Uint8Array(padLen);
    buf.set(msg); buf[n] = 0x80;
    buf[padLen - 8] = (bitLenHi >>> 24) & 255; buf[padLen - 7] = (bitLenHi >>> 16) & 255; buf[padLen - 6] = (bitLenHi >>> 8) & 255; buf[padLen - 5] = bitLenHi & 255;
    buf[padLen - 4] = (bitLenLo >>> 24) & 255; buf[padLen - 3] = (bitLenLo >>> 16) & 255; buf[padLen - 2] = (bitLenLo >>> 8) & 255; buf[padLen - 1] = bitLenLo & 255;
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    for (var off = 0; off < padLen; off += 64) {
      for (var i = 0; i < 16; i++) W[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
      for (i = 16; i < 64; i++) { var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0; }
    var out = new Uint8Array(32); for (var j = 0; j < 8; j++) { out[4 * j] = H[j] >>> 24; out[4 * j + 1] = (H[j] >>> 16) & 255; out[4 * j + 2] = (H[j] >>> 8) & 255; out[4 * j + 3] = H[j] & 255; }
    return out;
  }
  var TE = new TextEncoder(), TD = new TextDecoder('utf-8');
  function toBytes(v) { if (v instanceof Uint8Array) return v; if (Array.isArray(v)) return Uint8Array.from(v.map(function (b) { return b < 0 ? b + 256 : b; })); return TE.encode(String(v)); }
  function signed(u8) { var o = new Array(u8.length); for (var i = 0; i < u8.length; i++) o[i] = u8[i] > 127 ? u8[i] - 256 : u8[i]; return o; }
  function hmac(keyBytes, msgBytes) {
    if (keyBytes.length > 64) keyBytes = sha256Bytes(keyBytes);
    var k = new Uint8Array(64); k.set(keyBytes); var ip = new Uint8Array(64 + msgBytes.length), op = new Uint8Array(96);
    for (var i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; } ip.set(msgBytes, 64); op.set(sha256Bytes(ip), 64); return sha256Bytes(op);
  }
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  // ── 以引擎包內之檔案建立模擬服務（不提供 SpreadsheetApp、CacheService、LockService；鹽與金鑰一律不存在）
  function makeServices(files, props) {
    var P = Object.assign({ ANSHIN_FOLDER_ID: 'engine-pack', ANSHIN_RUNTIME_BUNDLE: 'disabled', ANSHIN_ENVIRONMENT: 'production' }, props || {});
    var folder = { getFilesByName: function (n) { var used = false, has = Object.prototype.hasOwnProperty.call(files, n);
      return { hasNext: function () { return !used && has; }, next: function () { used = true; return { getName: function () { return n; }, getBlob: function () { return { getDataAsString: function () { return files[n]; } }; } }; } }; },
      getFiles: function () { var ks = Object.keys(files), i = 0; return { hasNext: function () { return i < ks.length; }, next: function () { var n = ks[i++]; return { getName: function () { return n; }, getBlob: function () { return { getDataAsString: function () { return files[n]; } }; } }; } }; } };
    return {
      DriveApp: { getFolderById: function () { return folder; } },
      PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return Object.prototype.hasOwnProperty.call(P, k) ? P[k] : null; }, setProperty: function (k, v) { P[k] = String(v); }, getProperties: function () { return Object.assign({}, P); } }; } },
      Session: { getActiveUser: function () { return { getEmail: function () { return ''; } }; }, getEffectiveUser: function () { return { getEmail: function () { return ''; } }; } },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
        computeDigest: function (alg, v) { return signed(sha256Bytes(toBytes(v))); },
        computeHmacSha256Signature: function (v, k) { return signed(hmac(toBytes(k), toBytes(v))); },
        getUuid: function () { return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); },
        base64EncodeWebSafe: function (v) { return b64(toBytes(v)).replace(/\+/g, '-').replace(/\//g, '_'); },
        base64DecodeWebSafe: function (s) { return signed(unb64(String(s).replace(/-/g, '+').replace(/_/g, '/'))); },
        newBlob: function (bytes) { return { getDataAsString: function () { return TD.decode(toBytes(bytes)); } }; },
        formatDate: function (d) { return new Date(new Date(d).getTime() + 8 * 3600e3).toISOString().slice(0, 10); },
        sleep: function () {}
      },
      Logger: { log: function () {} }
    };
  }
  var api = { sha256Bytes: sha256Bytes, hmac: hmac, makeServices: makeServices, toHex: function (u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16); return s; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AnshinEngineEnv = api;
})(typeof self !== 'undefined' ? self : this);
