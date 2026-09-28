/**
 * HDT POS - Code.gs  (Google Apps Script)
 * Titik masuk web app + penghubung ke Google Sheets.
 *
 * PENTING: fungsi publik di file ini bisa dipanggil dari browser lewat google.script.run.
 * Karena itu semua fungsi pembantu diberi akhiran "_" (privat), dan fungsi yang
 * berbahaya (resetAdminPassword, isiDataContoh) hanya jalan bila dijalankan oleh
 * pemilik script sendiri.
 */

var DB_NAME_ = 'HDT POS Database';

/* ---------------- web app ---------------- */
function doGet(e) {
  // Dipanggil dengan ?api=1 : dipakai oleh aplikasi PWA/Android (di-hosting terpisah,
  // di luar domain script.google.com) untuk sinkronisasi lewat fetch() biasa, karena
  // Apps Script tidak bisa menjalankan Service Worker/PWA pada domain sandbox-nya sendiri.
  if (e && e.parameter && e.parameter.api === '1') {
    return apiHttp_(e.parameter.action, e.parameter.token, e.parameter.payload);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('HDT POS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Pintu masuk HTTP untuk aplikasi yang di-hosting terpisah (PWA/Android).
 * Dipanggil lewat fetch() biasa (bukan google.script.run), memakai
 * Content-Type: text/plain agar browser tidak mengirim preflight OPTIONS
 * (Apps Script tidak bisa menjawab preflight, jadi request harus "simple request").
 */
function doPost(e) {
  var body = {};
  try { body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return apiHttp_(null, null, null, 'Data yang dikirim tidak valid.'); }
  return apiHttp_(body.action, body.token, body.payload ? JSON.stringify(body.payload) : '{}');
}

function apiHttp_(action, token, payloadJson, badMsg) {
  var json = badMsg ? JSON.stringify({ ok: false, error: badMsg, code: 'BAD' }) : apiCall(action, token, payloadJson);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/** Satu-satunya pintu API dari halaman web. Selalu mengembalikan string JSON. */
function apiCall(action, token, payloadJson) {
  var payload;
  try { payload = payloadJson ? JSON.parse(payloadJson) : {}; }
  catch (e) { return JSON.stringify({ ok: false, error: 'Data yang dikirim tidak valid.', code: 'BAD' }); }
  try {
    ensureSetup_();
    return JSON.stringify(createBackend_(gasPlatform_()).handle(String(action), String(token || ''), payload));
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Kesalahan server: ' + (e && e.message ? e.message : e), code: 'SERVER' });
  }
}

/* ---------------- setup (jalankan sekali dari editor) ---------------- */
function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSS_();
    ensureSheets_(ss);
    var P = gasPlatform_();
    createBackend_(P).seedBase();
    PropertiesService.getScriptProperties().setProperty('SETUP_DONE', '1');
    Logger.log('SELESAI. Database: ' + ss.getUrl());
    Logger.log('Login awal: admin / admin123 (segera ganti setelah masuk).');
  } finally { lock.releaseLock(); }
}

function ensureSetup_() {
  // Jangan hanya mengandalkan flag SETUP_DONE. Jika schema baru (misalnya
  // Services) ditambahkan setelah setup lama, sheet tersebut tetap harus
  // dibuat secara otomatis tanpa menghapus data sheet yang sudah ada.
  var ss = getSS_();
  ensureSheets_(ss);

  if (PropertiesService.getScriptProperties().getProperty('SETUP_DONE') !== '1') {
    var P = gasPlatform_();
    createBackend_(P).seedBase();
    PropertiesService.getScriptProperties().setProperty('SETUP_DONE', '1');
  }
}

/**
 * Perbaikan database aman: jalankan dari editor Apps Script jika ingin
 * memastikan semua sheet/schema terbaru tersedia. Tidak menghapus data lama.
 */
function repairDatabase() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSS_();
    ensureSheets_(ss);
    if (PropertiesService.getScriptProperties().getProperty('SETUP_DONE') !== '1') {
      createBackend_(gasPlatform_()).seedBase();
      PropertiesService.getScriptProperties().setProperty('SETUP_DONE', '1');
    }
    Logger.log('Perbaikan selesai. Sheet Services dan schema lainnya sudah diperiksa. Database: ' + ss.getUrl());
  } finally {
    lock.releaseLock();
  }
}

/* Hanya pemilik script yang boleh menjalankan fungsi di bawah ini. */
function assertOwner_() {
  var eff = Session.getEffectiveUser().getEmail(), act = Session.getActiveUser().getEmail();
  if (!eff || eff !== act) { throw new Error('Hanya pemilik script yang boleh menjalankan fungsi ini dari editor Apps Script.'); }
}

/** Lupa password admin? Jalankan fungsi ini dari editor: password akun "admin" kembali menjadi admin123. */
function resetAdminPassword() {
  assertOwner_();
  var P = gasPlatform_(), b = createBackend_(P), u = P.db.all('Users').filter(function (x) { return x.username === 'admin'; })[0];
  if (!u) { throw new Error('Akun "admin" tidak ditemukan. Lihat sheet Users.'); }
  var salt = b.util.newSalt();
  P.db.update('Users', u.id, { salt: salt, pass_hash: b.util.hashPw(salt, 'admin123'), active: true, role: 'admin' });
  CacheService.getScriptCache().remove('fail:admin');
  Logger.log('Password akun admin di-reset menjadi: admin123');
}

/** Opsional: isi beberapa produk & pelanggan contoh untuk mencoba aplikasi. */
function isiDataContoh() {
  assertOwner_();
  ensureSetup_();
  var P = gasPlatform_(), db = P.db, now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (db.all('Products').length) { Logger.log('Sudah ada produk, data contoh tidak ditambahkan.'); return; }
  ['Elektronik', 'Aksesoris', 'Jasa'].forEach(function (c) { db.insert('Categories', { name: c }); });
  [['barang', 'Aksesoris', 'FD-64', '8990000000042', 'Flashdisk 64GB', 'pcs', 55000, 75000, 20, 5],
   ['barang', 'Aksesoris', 'MS-WL', '8990000000080', 'Mouse Wireless', 'pcs', 75000, 110000, 15, 5],
   ['barang', 'Elektronik', 'RTR-AC1200', '8990000000103', 'Router WiFi AC1200', 'pcs', 340000, 435000, 8, 3],
   ['jasa', 'Jasa', 'JS-SERVIS', '', 'Jasa Servis Laptop', 'unit', 0, 175000, 0, 0]
  ].forEach(function (r) {
    db.insert('Products', { type: r[0], category: r[1], sku: r[2], barcode: r[3], name: r[4], unit: r[5], cost_price: r[6], price: r[7], stock: r[8], min_stock: r[9], track_stock: r[0] === 'barang', created_at: now });
  });
  db.insert('Customers', { name: 'PT. Contoh Pelanggan', phone: '021-5550000', email: '', address: 'Jl. Contoh No. 1, Subang', created_at: now });
  Logger.log('Data contoh ditambahkan.');
}

/* ---------------- platform Google ---------------- */
function getSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) { return SpreadsheetApp.openById(id); }
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) { ss = SpreadsheetApp.create(DB_NAME_); }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function gasPlatform_() {
  var secret = null, sdb = null;
  return {
    get db() { if (!sdb) { sdb = sheetDb_(getSS_()); } return sdb; },
    sha256: function (s) {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8), out = '';
      for (var i = 0; i < bytes.length; i++) { var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i]; out += (b < 16 ? '0' : '') + b.toString(16); }
      return out;
    },
    now: function () { return new Date(); },
    lock: function (fn) {
      var l = LockService.getScriptLock();
      l.waitLock(25000);
      try { return fn(); } finally { l.releaseLock(); }
    },
    secret: function () {
      if (secret) { return secret; }
      var props = PropertiesService.getScriptProperties();
      secret = props.getProperty('HMAC_SECRET');
      if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); props.setProperty('HMAC_SECRET', secret); }
      return secret;
    },
    cacheGet: function (k) { return CacheService.getScriptCache().get(k); },
    cachePut: function (k, v, sec) { CacheService.getScriptCache().put(k, v, sec); },
    log: function (e) { console.error(e && e.stack ? e.stack : e); }
  };
}

/* ---------------- Google Sheets sebagai database ---------------- */
function ensureSheets_(ss) {
  Object.keys(SCHEMA).forEach(function (t) {
    var cols = SCHEMA[t], s = ss.getSheetByName(t);
    if (!s) { s = ss.insertSheet(t); }
    if (s.getMaxColumns() < cols.length) { s.insertColumnsAfter(s.getMaxColumns(), cols.length - s.getMaxColumns()); }
    if (s.getMaxRows() < 1000) { s.insertRowsAfter(s.getMaxRows(), 1000 - s.getMaxRows()); }
    formatColumns_(s, cols, 1, s.getMaxRows());
    s.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground('#e6ecff');
    s.setFrozenRows(1);
  });
  // buang lembar bawaan kosong (namanya beda-beda tergantung bahasa)
  ss.getSheets().forEach(function (sheet) {
    if (!SCHEMA[sheet.getName()] && sheet.getLastRow() === 0 && ss.getSheets().length > 1) { ss.deleteSheet(sheet); }
  });
}

/** Kolom teks diformat "Plain text" agar barcode/telepon/tanggal tidak diubah Sheets dan teks berawalan "=" tidak jadi rumus. */
function formatColumns_(s, cols, row, count) {
  for (var i = 0; i < cols.length; i++) {
    if (cols[i][1] === 's') { s.getRange(row, i + 1, count, 1).setNumberFormat('@'); }
  }
}

function sheetDb_(ss) {
  var sheets = {}, cache = {}, kvCache = null;
  function sh(t) {
    if (!sheets[t]) {
      sheets[t] = ss.getSheetByName(t);
      if (!sheets[t]) { throw new Error('Sheet "' + t + '" tidak ditemukan. Jalankan fungsi setup() dari editor Apps Script.'); }
    }
    return sheets[t];
  }
  function fromCell(v, type) {
    if (type === 'n') { if (v === '' || v === null) { return 0; } var n = Number(v); return isFinite(n) ? n : 0; }
    if (type === 'b') { return v === true || v === 1 || v === '1' || String(v).toUpperCase() === 'TRUE'; }
    if (v instanceof Date) { return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'); }
    return (v === null || v === undefined) ? '' : String(v);
  }
  function toCell(v, type) {
    if (type === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
    if (type === 'b') { return (v === true || v === 1 || v === '1') ? 1 : 0; }
    return (v === null || v === undefined) ? '' : String(v);
  }
  function objFromRow(cols, row) { var o = {}; for (var j = 0; j < cols.length; j++) { o[cols[j][0]] = fromCell(row[j], cols[j][1]); } return o; }
  function rowFromObj(cols, o) { var r = []; for (var j = 0; j < cols.length; j++) { r.push(toCell(o[cols[j][0]], cols[j][1])); } return r; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function read(t) {
    if (cache[t]) { return cache[t]; }
    var cols = SCHEMA[t], s = sh(t), last = s.getLastRow(), list = [];
    if (last >= 2) {
      var vals = s.getRange(2, 1, last - 1, cols.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (vals[i][0] === '' || vals[i][0] === null) { continue; }
        list.push({ r: i + 2, o: objFromRow(cols, vals[i]) });
      }
    }
    cache[t] = list;
    return list;
  }
  function maxId(list) { var m = 0; list.forEach(function (x) { if (x.o.id > m) { m = x.o.id; } }); return m; }
  function ensureRows(t, s, needRow) {
    var max = s.getMaxRows();
    if (needRow > max) {
      var add = needRow - max + 500;
      s.insertRowsAfter(max, add);
      formatColumns_(s, SCHEMA[t], max + 1, add);
    }
  }
  function appendRows(t, objs) {
    var cols = SCHEMA[t], s = sh(t), list = read(t), id = maxId(list), out = [], rows = [];
    objs.forEach(function (o) { var full = clone(o); full.id = ++id; rows.push(rowFromObj(cols, full)); out.push(full); });
    if (!rows.length) { return []; }
    var start = s.getLastRow() + 1;
    ensureRows(t, s, start + rows.length - 1);
    s.getRange(start, 1, rows.length, cols.length).setValues(rows);
    var res = [];
    rows.forEach(function (r, i) { var o = objFromRow(cols, r); list.push({ r: start + i, o: o }); res.push(clone(o)); });
    return res;
  }

  return {
    all: function (t) { return read(t).map(function (x) { return clone(x.o); }); },
    insert: function (t, o) { return appendRows(t, [o])[0]; },
    insertMany: function (t, arr) { return appendRows(t, arr); },
    update: function (t, id, patch) {
      var cols = SCHEMA[t], hit = read(t).filter(function (x) { return x.o.id === id; })[0];
      if (!hit) { return null; }
      var merged = clone(hit.o); Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; }); merged.id = id;
      var row = rowFromObj(cols, merged);
      sh(t).getRange(hit.r, 1, 1, cols.length).setValues([row]);
      hit.o = objFromRow(cols, row);
      return clone(hit.o);
    },
    removeMany: function (t, ids) {
      var cols = SCHEMA[t], s = sh(t), list = read(t), keep = list.filter(function (x) { return ids.indexOf(x.o.id) < 0; });
      var removed = list.length - keep.length;
      if (!removed) { return 0; }
      var last = s.getLastRow();
      if (last >= 2) { s.getRange(2, 1, last - 1, cols.length).clearContent(); }
      if (keep.length) { s.getRange(2, 1, keep.length, cols.length).setValues(keep.map(function (x) { return rowFromObj(cols, x.o); })); }
      keep.forEach(function (x, i) { x.r = i + 2; });
      cache[t] = keep;
      return removed;
    },
    kv: function () {
      if (!kvCache) {
        var s = sh('Settings'), last = s.getLastRow(), o = {};
        if (last >= 2) {
          s.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) { if (r[0] !== '' && r[0] !== null) { o[String(r[0])] = (r[1] === null || r[1] === undefined) ? '' : String(r[1]); } });
        }
        kvCache = o;
      }
      return clone(kvCache);
    },
    kvWrite: function (set, del) {
      var o = this.kv(), s = sh('Settings');
      Object.keys(set).forEach(function (k) { o[k] = String(set[k]); });
      (del || []).forEach(function (k) { delete o[k]; });
      var keys = Object.keys(o), last = s.getLastRow();
      if (last >= 2) { s.getRange(2, 1, last - 1, 2).clearContent(); }
      if (keys.length) {
        ensureRows('Settings', s, keys.length + 1);
        s.getRange(2, 1, keys.length, 2).setValues(keys.map(function (k) { return [k, o[k]]; }));
      }
      kvCache = o;
    }
  };
}
