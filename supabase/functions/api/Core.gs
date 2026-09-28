/**
 * HDT POS - Core.gs
 * Logika bisnis (login, kasir, produk, pelanggan, user, laporan).
 * File ini TIDAK memanggil layanan Google secara langsung; semua akses data dan
 * kripto lewat objek "platform" (lihat Code.gs). Karena itu file yang sama juga
 * dipakai oleh demo di browser.
 */

var APP_VERSION = '1.0.0';
var TZ_HOURS = 7;            // WIB (UTC+7)
var SESSION_HOURS = 12;      // masa berlaku login
var METHODS = ['cash', 'transfer', 'debit', 'credit', 'qris'];
var ROLES = ['admin', 'kasir']; // admin = "Kasir Admin", kasir = "Kasir" biasa

// Skema tabel. Tipe kolom: n = angka, s = teks, b = ya/tidak (disimpan 1/0)
var SCHEMA = {
  Users: [['id','n'],['username','s'],['salt','s'],['pass_hash','s'],['full_name','s'],['role','s'],['active','b'],['last_login','s'],['created_at','s']],
  Categories: [['id','n'],['name','s']],
  Products: [['id','n'],['type','s'],['category','s'],['sku','s'],['barcode','s'],['name','s'],['unit','s'],['cost_price','n'],['price','n'],['stock','n'],['min_stock','n'],['track_stock','b'],['created_at','s']],
  Customers: [['id','n'],['name','s'],['phone','s'],['email','s'],['address','s'],['created_at','s']],
  Transactions: [['id','n'],['invoice_no','s'],['date','s'],['user_id','n'],['user_name','s'],['customer_id','n'],['customer_name','s'],['customer_addr','s'],['subtotal','n'],['discount_type','s'],['discount_value','n'],['discount_amount','n'],['tax_rate','n'],['tax_amount','n'],['grand_total','n'],['method','s'],['amount_paid','n'],['change','n'],['status','s'],['note','s']],
  TxItems: [['id','n'],['tx_id','n'],['invoice_no','s'],['date','s'],['user_id','n'],['product_id','n'],['name','s'],['type','s'],['qty','n'],['price','n'],['cost','n'],['subtotal','n']],
  Evaluations: [['id','n'],['user_id','n'],['from','s'],['to','s'],['rating','n'],['bonus','n'],['note','s'],['updated_at','s'],['updated_by','s']],
  StockLog: [['id','n'],['date','s'],['product_id','n'],['name','s'],['user_name','s'],['type','s'],['change','n'],['before','n'],['after','n'],['note','s']],
  Settings: [['key','s'],['value','s']],
  Services: [['id','n'],['service_no','s'],['date_in','s'],['date_out','s'],['customer_name','s'],['phone','s'],['item_name','s'],['item_color','s'],['completeness','s'],['problem','s'],['status','s'],['received_by','n'],['received_by_name','s'],['picked_up_at','s'],['note','s']]
};

var SETTING_DEFAULTS = {
  store_name: 'HDT POS', store_address: '', store_phone: '', store_email: '', tax_no: '',
  bank_name: '', bank_account: '', bank_holder: '',
  tax_rate: '0', paper_width: '80', receipt_footer: 'Terima kasih atas kunjungan Anda.',
  show_logo_on_receipt: '1', auto_print: '0', inv_code: '200', inv_year: '', inv_next: '1'
};

/* ---------------- util tanggal & angka ---------------- */
function pad_(n, w) { var s = String(n); while (s.length < w) { s = '0' + s; } return s; }
function wib_(d) {
  var t = new Date(d.getTime() + TZ_HOURS * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), i: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function ymd_(p) { return p.y + '-' + pad_(p.m, 2) + '-' + pad_(p.d, 2); }
function fmtDate_(d) { return ymd_(wib_(d)); }
function fmtDateTime_(d) { var p = wib_(d); return ymd_(p) + ' ' + pad_(p.h, 2) + ':' + pad_(p.i, 2) + ':' + pad_(p.s, 2); }
function isYmd_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function addDays_(s, n) {
  var a = s.split('-');
  var t = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n));
  return t.getUTCFullYear() + '-' + pad_(t.getUTCMonth() + 1, 2) + '-' + pad_(t.getUTCDate(), 2);
}
function diffDays_(a, b) { // b - a (hari)
  var x = a.split('-'), y = b.split('-');
  return Math.round((Date.UTC(+y[0], +y[1] - 1, +y[2]) - Date.UTC(+x[0], +x[1] - 1, +x[2])) / 86400000);
}
function round0_(v) { return Math.round(v); }
function round2_(v) { return Math.round(v * 100) / 100; }

/* ================================================================ */
function createBackend_(P) {
  var db = P.db;

  function fail(msg, code) { var e = new Error(msg); e.isApp = true; e.code = code || 'ERR'; throw e; }

  /* ---------- validasi ---------- */
  function str(v, max, label, required) {
    var s = (v === null || v === undefined) ? '' : String(v).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim();
    if (required && !s) { fail(label + ' wajib diisi.'); }
    if (s.length > max) { fail(label + ' terlalu panjang (maksimal ' + max + ' karakter).'); }
    return s;
  }
  function num(v, label, min, max) {
    var n = Number(v);
    if (v === '' || v === null || v === undefined || !isFinite(n)) { fail(label + ' harus berupa angka.'); }
    if (n < min) { fail(label + ' tidak boleh kurang dari ' + min + '.'); }
    if (n > max) { fail(label + ' terlalu besar.'); }
    return n;
  }
  function int(v, label, min, max) {
    var n = num(v, label, min, max);
    if (Math.floor(n) !== n) { fail(label + ' harus bilangan bulat.'); }
    return n;
  }
  function idList(v) {
    if (!Array.isArray(v) || !v.length) { fail('Tidak ada data yang dipilih.'); }
    if (v.length > 1000) { fail('Terlalu banyak data dipilih sekaligus (maksimal 1000).'); }
    return v.map(function (x) { return refId(x, 'ID'); });
  }
  // ID rujukan ke baris lain (mis. product_id, customer_id, atau id baris yang diedit/dihapus).
  // Server SELALU memberi id positif, tapi mesin offline (PWA) sementara memberi id NEGATIF
  // untuk baris yang baru dibuat di perangkat & belum tersinkron -- supaya kasir/produk/dst
  // tetap bisa dipakai (dan saling berelasi) sepenuhnya offline sebelum ada koneksi internet.
  // Karena itu rentang di sini sengaja mencakup negatif; server sendiri tidak pernah menerima
  // id negatif sungguhan karena mesin offline menuliskan ulang semua id sementara ini menjadi
  // id asli dari server sesaat setelah tersinkron (lihat rewriteRefs_ di engine.js).
  function refId(v, label) {
    var n = int(v, label, -1e12, 1e12);
    if (n === 0) { fail(label + ' tidak valid.'); }
    return n;
  }

  /* ---------- kripto ---------- */
  function hashPw(salt, pw) {
    var h = pw;
    for (var i = 0; i < 100; i++) { h = P.sha256(salt + ':' + h + ':' + pw); }
    return h;
  }
  function newSalt() { return P.sha256(P.secret() + ':' + Math.random() + ':' + new Date().getTime()).slice(0, 24); }
  function sign(msg) { var s = P.secret(); return P.sha256(s + ':' + P.sha256(s + ':' + msg)).slice(0, 40); }
  function makeToken(u) {
    var exp = Math.floor(P.now().getTime() / 1000) + SESSION_HOURS * 3600;
    var body = u.id + '.' + exp + '.' + u.pass_hash.slice(0, 8);
    return body + '.' + sign(body);
  }
  function authUser(token, roles) {
    var t = String(token || '').split('.');
    if (t.length !== 4) { fail('Sesi berakhir. Silakan masuk kembali.', 'AUTH'); }
    var body = t[0] + '.' + t[1] + '.' + t[2];
    if (sign(body) !== t[3]) { fail('Sesi tidak valid. Silakan masuk kembali.', 'AUTH'); }
    if (Number(t[1]) < Math.floor(P.now().getTime() / 1000)) { fail('Sesi berakhir. Silakan masuk kembali.', 'AUTH'); }
    var u = db.all('Users').filter(function (x) { return x.id === Number(t[0]); })[0];
    if (!u || !u.active || u.pass_hash.slice(0, 8) !== t[2]) { fail('Sesi tidak valid. Silakan masuk kembali.', 'AUTH'); }
    if (roles && roles.indexOf(u.role) < 0) { fail('Anda tidak memiliki hak akses untuk fitur ini.', 'FORBIDDEN'); }
    return u;
  }

  /* ---------- pengaturan ---------- */
  function currentYY() { return pad_(wib_(P.now()).y % 100, 2); }
  function loadSettings() {
    var kv = db.kv(), s = {}, k;
    for (k in SETTING_DEFAULTS) { s[k] = Object.prototype.hasOwnProperty.call(kv, k) ? kv[k] : SETTING_DEFAULTS[k]; }
    var parts = [], i = 0;
    while (kv['store_logo_' + i] !== undefined && kv['store_logo_' + i] !== '') { parts.push(kv['store_logo_' + i]); i++; }
    var yy = currentYY();
    var qrisReady = kv['qris_image_0'] !== undefined && kv['qris_image_0'] !== '';
    var next = (kv.inv_year === yy) ? (Number(kv.inv_next) || 1) : 1;
    return {
      store_name: s.store_name, store_address: s.store_address, store_phone: s.store_phone, store_email: s.store_email,
      tax_no: s.tax_no, bank_name: s.bank_name, bank_account: s.bank_account, bank_holder: s.bank_holder,
      tax_rate: Number(s.tax_rate) || 0, paper_width: Number(s.paper_width) === 58 ? 58 : 80,
      receipt_footer: s.receipt_footer, show_logo_on_receipt: s.show_logo_on_receipt === '1',
      auto_print: s.auto_print === '1', inv_code: s.inv_code || '200', inv_next: next, inv_yy: yy,
      inv_preview: yy + '-' + (s.inv_code || '200') + '-' + pad_(next, 6),
      store_logo: parts.join(''), qris_ready: qrisReady
    };
  }
  function invoiceEligible(t) {
    return t.customer_id > 0 && (t.method === 'cash' || t.method === 'transfer') && t.status === 'completed';
  }

  /* ---------- bentuk data keluar ---------- */
  function pubUser(u) { return { id: u.id, username: u.username, full_name: u.full_name, role: u.role }; }
  function pubProduct(p, withCost) {
    var o = { id: p.id, type: p.type, category: p.category, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit,
              price: p.price, stock: p.stock, min_stock: p.min_stock, track_stock: p.track_stock };
    if (withCost) { o.cost_price = p.cost_price; }
    return o;
  }
  function pubCustomer(c) { return { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address }; }
  function txPayload(t, items) {
    return {
      id: t.id, invoice_no: t.invoice_no, date: t.date, user_id: t.user_id, cashier: t.user_name,
      customer_id: t.customer_id, customer: t.customer_name, customer_addr: t.customer_addr,
      items: items.map(function (i) { return { product_id: i.product_id, name: i.name, type: i.type, qty: i.qty, price: i.price, subtotal: i.subtotal }; }),
      subtotal: t.subtotal, discount_type: t.discount_type, discount_value: t.discount_value, discount_amount: t.discount_amount,
      tax_rate: t.tax_rate, tax_amount: t.tax_amount, grand_total: t.grand_total, method: t.method,
      amount_paid: t.amount_paid, change: t.change, status: t.status, note: t.note, invoice_eligible: invoiceEligible(t)
    };
  }
  function txSummary(t) {
    return { id: t.id, invoice_no: t.invoice_no, date: t.date, user_id: t.user_id, cashier: t.user_name, customer: t.customer_name,
             method: t.method, grand_total: t.grand_total, status: t.status, invoice_eligible: invoiceEligible(t) };
  }

  /* ---------- hitung total (dipakai checkout & data contoh) ---------- */
  function computeTotals(subtotal, discType, discValue, taxRate) {
    var disc = 0;
    if (discType === 'percent') { disc = round0_(subtotal * discValue / 100); }
    else if (discType === 'amount') { disc = round0_(discValue); }
    disc = Math.min(disc, subtotal);
    var taxable = subtotal - disc;
    var tax = round0_(taxable * taxRate / 100);
    return { discount: disc, tax: tax, grand: taxable + tax };
  }
  function invoiceNo(yy, code, seq) { return yy + '-' + code + '-' + pad_(seq, 6); }

  /* ================================================================
     AKSI
     ================================================================ */
  var A = {};

  /* ----- publik ----- */
  A.publicInfo = { auth: false, run: function () {
    var s = loadSettings();
    return { store_name: s.store_name, store_logo: s.store_logo, version: APP_VERSION };
  } };

  A.login = { auth: false, write: true, run: function (p) {
    var uname = str(p.username, 50, 'Username', true).toLowerCase();
    var pw = String(p.password || '');
    var key = 'fail:' + uname;
    var fails = Number(P.cacheGet(key) || 0);
    if (fails >= 5) { fail('Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.', 'LOCK'); }
    var u = db.all('Users').filter(function (x) { return x.username.toLowerCase() === uname; })[0];
    if (!u || !u.active || hashPw(u.salt, pw) !== u.pass_hash) {
      P.cachePut(key, String(fails + 1), 600);
      fail('Username atau password salah.', 'LOGIN');
    }
    P.cachePut(key, '0', 1);
    db.update('Users', u.id, { last_login: fmtDateTime_(P.now()) });
    return { token: makeToken(u), user: pubUser(u), default_password: u.username === 'admin' && hashPw(u.salt, 'admin123') === u.pass_hash };
  } };

  /* ----- semua user yang login ----- */
  A.bootstrap = { roles: ['admin', 'kasir'], run: function (p, user) {
    return {
      user: pubUser(user),
      settings: loadSettings(),
      products: db.all('Products').map(function (p) { return pubProduct(p, false); }),
      categories: db.all('Categories').map(function (c) { return c.name; }),
      customers: db.all('Customers').map(pubCustomer)
    };
  } };

  A.checkout = { roles: ['admin', 'kasir'], write: true, run: function (p, user) {
    var raw = p.items;
    if (!Array.isArray(raw) || !raw.length) { fail('Keranjang masih kosong.'); }
    if (raw.length > 200) { fail('Terlalu banyak item dalam satu transaksi (maksimal 200).'); }
    var qtyById = {}, order = [];
    raw.forEach(function (it) {
      var pid = refId(it && it.product_id, 'Produk');
      var q = int(it && it.qty, 'Jumlah', 1, 999999);
      if (!qtyById[pid]) { qtyById[pid] = 0; order.push(pid); }
      qtyById[pid] += q;
    });

    var customer = null;
    if (p.customer_id) {
      var cid = refId(p.customer_id, 'Pelanggan');
      customer = db.all('Customers').filter(function (c) { return c.id === cid; })[0];
      if (!customer) { fail('Pelanggan tidak ditemukan (mungkin sudah dihapus).'); }
    }
    var discType = p.discount_type || 'none';
    if (['none', 'percent', 'amount'].indexOf(discType) < 0) { fail('Jenis diskon tidak valid.'); }
    var discValue = 0;
    if (discType !== 'none') {
      discValue = num(p.discount_value || 0, 'Diskon', 0, 1e12);
      if (discType === 'percent' && discValue > 100) { fail('Diskon persen tidak boleh lebih dari 100.'); }
      if (discValue === 0) { discType = 'none'; }
    }
    var method = String(p.payment_method || '');
    if (METHODS.indexOf(method) < 0) { fail('Metode pembayaran tidak valid.'); }
    var note = str(p.note, 200, 'Catatan', false);

    var settings = loadSettings();
    var products = db.all('Products');
    var byId = {};
    products.forEach(function (x) { byId[x.id] = x; });

    var lines = [], subtotal = 0;
    order.forEach(function (pid) {
      var pr = byId[pid], q = qtyById[pid];
      if (!pr) { fail('Ada produk yang sudah dihapus. Muat ulang halaman kasir.'); }
      if (pr.track_stock && pr.stock < q) { fail('Stok "' + pr.name + '" tidak cukup (tersisa ' + pr.stock + ', diminta ' + q + ').'); }
      var sub = round2_(pr.price * q);
      subtotal += sub;
      lines.push({ pr: pr, qty: q, subtotal: sub });
    });
    subtotal = round2_(subtotal);
    var tot = computeTotals(subtotal, discType, discValue, settings.tax_rate);
    var paid = tot.grand, change = 0;
    if (method === 'cash') {
      paid = num(p.amount_paid || 0, 'Uang diterima', 0, 1e13);
      if (paid + 0.0001 < tot.grand) { fail('Uang yang diterima kurang dari total belanja.'); }
      change = round2_(paid - tot.grand);
    }

    // nomor invoice otomatis: YY-KODE-URUT6, urutan mulai 1 tiap tahun
    var now = P.now(), yy = currentYY();
    var kv = db.kv();
    var seq = (kv.inv_year === yy) ? (Number(kv.inv_next) || 1) : 1;
    var no = invoiceNo(yy, settings.inv_code, seq);

    var tx = db.insert('Transactions', {
      invoice_no: no, date: fmtDateTime_(now), user_id: user.id, user_name: user.full_name,
      customer_id: customer ? customer.id : 0, customer_name: customer ? customer.name : '', customer_addr: customer ? customer.address : '',
      subtotal: subtotal, discount_type: discType, discount_value: discValue, discount_amount: tot.discount,
      tax_rate: settings.tax_rate, tax_amount: tot.tax, grand_total: tot.grand,
      method: method, amount_paid: paid, change: change, status: 'completed', note: note
    });
    var itemRows = lines.map(function (l) {
      return { tx_id: tx.id, invoice_no: no, date: tx.date, user_id: user.id, product_id: l.pr.id, name: l.pr.name, type: l.pr.type,
               qty: l.qty, price: l.pr.price, cost: l.pr.cost_price, subtotal: l.subtotal };
    });
    var saved = db.insertMany('TxItems', itemRows);
    lines.forEach(function (l) {
      if (l.pr.track_stock) { db.update('Products', l.pr.id, { stock: l.pr.stock - l.qty }); }
    });
    db.kvWrite({ inv_year: yy, inv_next: String(seq + 1) }, []);
    return txPayload(tx, saved);
  } };

  A.txList = { roles: ['admin', 'kasir'], run: function (p, user) {
    var today = fmtDate_(P.now());
    var from = isYmd_(p.from) ? p.from : today, to = isYmd_(p.to) ? p.to : today;
    if (to < from) { var t0 = from; from = to; to = t0; }
    var q = String(p.q || '').toLowerCase().trim();
    var uid = user.role === 'admin' ? Number(p.user_id || 0) : user.id;
    var rows = db.all('Transactions').filter(function (t) {
      var d = t.date.slice(0, 10);
      if (d < from || d > to) { return false; }
      if (uid && t.user_id !== uid) { return false; }
      if (q && (t.invoice_no + ' ' + t.customer_name + ' ' + t.user_name).toLowerCase().indexOf(q) < 0) { return false; }
      return true;
    });
    rows.sort(function (a, b) { return b.id - a.id; });
    var total = rows.length;
    return { total: total, from: from, to: to, rows: rows.slice(0, 300).map(txSummary) };
  } };

  function loadTx(id, user) {
    id = refId(id, 'Transaksi');
    var t = db.all('Transactions').filter(function (x) { return x.id === id; })[0];
    if (!t) { fail('Transaksi tidak ditemukan.'); }
    if (user.role !== 'admin' && t.user_id !== user.id) { fail('Anda hanya dapat melihat transaksi milik sendiri.', 'FORBIDDEN'); }
    var items = db.all('TxItems').filter(function (i) { return i.tx_id === t.id; });
    return txPayload(t, items);
  }
  A.txGet = { roles: ['admin', 'kasir'], run: function (p, user) { return loadTx(p.id, user); } };
  A.invoiceGet = { roles: ['admin', 'kasir'], run: function (p, user) {
    var t = loadTx(p.id, user);
    if (!t.invoice_eligible) { fail('Invoice hanya untuk pelanggan terdaftar dengan pembayaran tunai atau transfer.'); }
    var c = db.all('Customers').filter(function (x) { return x.id === t.customer_id; })[0];
    if (c) { t.customer = c.name; t.customer_addr = c.address; }
    return t;
  } };

  /* ----- service / reparasi ----- */
  function pubService(x) { return { id:x.id, service_no:x.service_no, date_in:x.date_in, date_out:x.date_out, customer_name:x.customer_name, phone:x.phone, item_name:x.item_name, item_color:x.item_color, completeness:x.completeness, problem:x.problem, status:x.status, received_by:x.received_by, received_by_name:x.received_by_name, picked_up_at:x.picked_up_at, note:x.note }; }
  A.serviceList = { roles: ['admin','kasir'], run: function (p, user) {
    var q = String(p.q || '').toLowerCase().trim(), status = String(p.status || 'all');
    var rows = db.all('Services').filter(function(x){
      if (status !== 'all' && x.status !== status) return false;
      if (q && (x.service_no+' '+x.customer_name+' '+x.phone+' '+x.item_name).toLowerCase().indexOf(q)<0) return false;
      return true;
    }).sort(function(a,b){ return b.id-a.id; });
    return { rows: rows.slice(0,500).map(pubService) };
  } };
  A.serviceSave = { roles: ['admin','kasir'], write: true, run: function(p,user) {
    var id = p.id ? int(p.id,'Service',1,1e12) : 0;
    var statuses = ['proses','tersedia','diambil'];
    var status = p.status ? String(p.status) : 'proses';
    if (statuses.indexOf(status)<0) fail('Status service tidak valid.');
    var o = { customer_name:str(p.customer_name,100,'Nama pelanggan',true), phone:str(p.phone,30,'Nomor HP',true), item_name:str(p.item_name,150,'Nama barang',true), item_color:str(p.item_color,80,'Warna',false), completeness:str(p.completeness,300,'Kelengkapan',false), problem:str(p.problem,1000,'Masalah',true), status:status, note:str(p.note,300,'Catatan',false) };
    var now=fmtDateTime_(P.now());
    if (id) { var old=db.all('Services').filter(function(x){return x.id===id;})[0]; if(!old) fail('Data service tidak ditemukan.'); if(status==='diambil' && old.status!=='diambil') o.picked_up_at=now; return pubService(db.update('Services',id,o)); }
    var yy=currentYY(), seq=Number(db.kv().service_next||1), no=yy+'-SRV-'+pad_(seq,6);
    o.service_no=no; o.date_in=now; o.date_out=''; o.received_by=user.id; o.received_by_name=user.full_name; o.picked_up_at='';
    var res=db.insert('Services',o); db.kvWrite({service_next:String(seq+1)},[]); return pubService(res);
  } };
  A.serviceGet = { roles: ['admin','kasir'], run: function(p){ var x=db.all('Services').filter(function(a){return a.id===int(p.id,'Service',1,1e12);})[0]; if(!x) fail('Data service tidak ditemukan.'); return pubService(x); } };

  /* ----- produk (admin) ----- */
  A.productList = { roles: ['admin'], run: function () {
    return { products: db.all('Products').map(function (p) { return pubProduct(p, true); }), categories: db.all('Categories').map(function (c) { return c.name; }) };
  } };

  A.productSave = { roles: ['admin'], write: true, run: function (p, user) {
    var type = p.type === 'jasa' ? 'jasa' : 'barang';
    var o = {
      type: type, name: str(p.name, 150, 'Nama', true), category: str(p.category, 60, 'Kategori', false),
      sku: str(p.sku, 50, 'SKU', false), barcode: str(p.barcode, 64, 'Barcode', false), unit: str(p.unit, 20, 'Satuan', false) || (type === 'jasa' ? 'jasa' : 'pcs'),
      price: num(p.price, 'Harga jual', 0, 1e12), cost_price: num(p.cost_price || 0, 'Harga modal', 0, 1e12),
      min_stock: int(p.min_stock || 0, 'Stok minimum', 0, 1e9),
      track_stock: type === 'barang' && p.track_stock !== false
    };
    var all = db.all('Products'), id = p.id ? refId(p.id, 'Produk') : 0;
    all.forEach(function (x) {
      if (x.id === id) { return; }
      if (o.sku && x.sku.toLowerCase() === o.sku.toLowerCase()) { fail('SKU "' + o.sku + '" sudah dipakai produk "' + x.name + '".'); }
      if (o.barcode && x.barcode === o.barcode) { fail('Barcode "' + o.barcode + '" sudah dipakai produk "' + x.name + '".'); }
    });
    if (o.category) {
      var has = db.all('Categories').some(function (c) { return c.name.toLowerCase() === o.category.toLowerCase(); });
      if (!has) { db.insert('Categories', { name: o.category }); }
    }
    var res;
    if (id) {
      if (!all.some(function (x) { return x.id === id; })) { fail('Produk tidak ditemukan.'); }
      res = db.update('Products', id, o);
    } else {
      o.stock = o.track_stock ? int(p.stock || 0, 'Stok awal', 0, 1e9) : 0;
      o.created_at = fmtDateTime_(P.now());
      res = db.insert('Products', o);
      if (o.stock > 0) { db.insert('StockLog', { date: o.created_at, product_id: res.id, name: res.name, user_name: user.full_name, type: 'awal', change: o.stock, before: 0, after: o.stock, note: 'Stok awal' }); }
    }
    return pubProduct(res, true);
  } };

  A.productDelete = { roles: ['admin'], write: true, run: function (p) {
    var ids = idList(p.ids);
    return { deleted: db.removeMany('Products', ids) };
  } };

  A.productStock = { roles: ['admin'], write: true, run: function (p, user) {
    var id = refId(p.id, 'Produk'), mode = String(p.mode);
    var pr = db.all('Products').filter(function (x) { return x.id === id; })[0];
    if (!pr) { fail('Produk tidak ditemukan.'); }
    if (!pr.track_stock) { fail('Produk ini tidak memakai stok (jasa / stok tidak dilacak).'); }
    var q = int(p.qty, 'Jumlah', 0, 1e9), after;
    if (mode === 'add') { after = pr.stock + q; }
    else if (mode === 'sub') { after = pr.stock - q; if (after < 0) { fail('Stok tidak bisa kurang dari 0 (stok saat ini ' + pr.stock + ').'); } }
    else if (mode === 'set') { after = q; }
    else { fail('Jenis penyesuaian stok tidak valid.'); }
    var res = db.update('Products', id, { stock: after });
    db.insert('StockLog', { date: fmtDateTime_(P.now()), product_id: id, name: pr.name, user_name: user.full_name, type: mode, change: after - pr.stock, before: pr.stock, after: after, note: str(p.note, 150, 'Catatan', false) });
    return pubProduct(res, true);
  } };

  /* ----- pelanggan (admin) ----- */
  A.customerList = { roles: ['admin'], run: function () {
    return { customers: db.all('Customers').map(pubCustomer) };
  } };
  A.customerSave = { roles: ['admin'], write: true, run: function (p) {
    var o = {
      name: str(p.name, 100, 'Nama pelanggan', true), phone: str(p.phone, 30, 'Telepon', false),
      email: str(p.email, 100, 'Email', false), address: str(p.address, 250, 'Alamat', false)
    };
    if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) { fail('Format email tidak valid.'); }
    var id = p.id ? refId(p.id, 'Pelanggan') : 0, res;
    if (id) {
      if (!db.all('Customers').some(function (c) { return c.id === id; })) { fail('Pelanggan tidak ditemukan.'); }
      res = db.update('Customers', id, o);
    } else {
      o.created_at = fmtDateTime_(P.now());
      res = db.insert('Customers', o);
    }
    return pubCustomer(res);
  } };
  A.customerDelete = { roles: ['admin'], write: true, run: function (p) {
    return { deleted: db.removeMany('Customers', idList(p.ids)) };
  } };

  /* ----- pengguna (admin) ----- */
  function pubUserFull(u) {
    return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active, last_login: u.last_login, created_at: u.created_at };
  }
  function activeAdmins(users, exceptIds) {
    return users.filter(function (u) { return u.role === 'admin' && u.active && exceptIds.indexOf(u.id) < 0; }).length;
  }
  A.userList = { roles: ['admin'], run: function () {
    return { users: db.all('Users').map(pubUserFull) };
  } };
  A.userSave = { roles: ['admin'], write: true, run: function (p, me) {
    var users = db.all('Users');
    var id = p.id ? refId(p.id, 'User') : 0;
    var role = String(p.role);
    if (ROLES.indexOf(role) < 0) { fail('Peran user tidak valid.'); }
    var full = str(p.full_name, 100, 'Nama lengkap', true);
    var active = p.active !== false;
    var pw = String(p.password || '');
    if (id) {
      var u = users.filter(function (x) { return x.id === id; })[0];
      if (!u) { fail('User tidak ditemukan.'); }
      if (id === me.id && (role !== 'admin' || !active)) { fail('Anda tidak dapat menurunkan peran atau menonaktifkan akun Anda sendiri.'); }
      if ((u.role === 'admin' && u.active) && (role !== 'admin' || !active) && activeAdmins(users, [id]) < 1) { fail('Harus tersisa minimal satu Kasir Admin aktif.'); }
      var patch = { full_name: full, role: role, active: active };
      if (pw) {
        if (pw.length < 6) { fail('Password minimal 6 karakter.'); }
        patch.salt = newSalt(); patch.pass_hash = hashPw(patch.salt, pw);
      }
      return pubUserFull(db.update('Users', id, patch));
    }
    var uname = str(p.username, 30, 'Username', true).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(uname)) { fail('Username 3-30 karakter: huruf kecil, angka, titik, strip, atau garis bawah.'); }
    if (users.some(function (x) { return x.username.toLowerCase() === uname; })) { fail('Username "' + uname + '" sudah dipakai.'); }
    if (pw.length < 6) { fail('Password minimal 6 karakter.'); }
    var salt = newSalt();
    return pubUserFull(db.insert('Users', { username: uname, salt: salt, pass_hash: hashPw(salt, pw), full_name: full, role: role, active: active, last_login: '', created_at: fmtDateTime_(P.now()) }));
  } };
  A.userDelete = { roles: ['admin'], write: true, run: function (p, me) {
    var ids = idList(p.ids);
    if (ids.indexOf(me.id) >= 0) { fail('Anda tidak dapat menghapus akun Anda sendiri.'); }
    if (activeAdmins(db.all('Users'), ids) < 1) { fail('Harus tersisa minimal satu Kasir Admin aktif.'); }
    return { deleted: db.removeMany('Users', ids) };
  } };
  A.passwordChange = { roles: ['admin', 'kasir'], write: true, run: function (p, me) {
    var cur = String(p.current || ''), nw = String(p.password || '');
    if (hashPw(me.salt, cur) !== me.pass_hash) { fail('Password saat ini salah.'); }
    if (nw.length < 6) { fail('Password baru minimal 6 karakter.'); }
    var salt = newSalt(), h = hashPw(salt, nw);
    db.update('Users', me.id, { salt: salt, pass_hash: h });
    return { token: makeToken({ id: me.id, pass_hash: h }) };
  } };

  /* ----- gambar QRIS (dibaca kasir saat pembayaran QRIS) ----- */
  A.qrisGet = { roles: ['admin', 'kasir'], run: function () {
    var kv = db.kv(), parts = [], i = 0;
    while (kv['qris_image_' + i] !== undefined && kv['qris_image_' + i] !== '') { parts.push(kv['qris_image_' + i]); i++; }
    return { image: parts.join('') };
  } };

  /* ----- pengaturan (admin) ----- */
  A.settingsSave = { roles: ['admin'], write: true, run: function (p) {
    var set = {}, del = [], cur = loadSettings();
    var textKeys = { store_name: [100, true], store_address: [250, false], store_phone: [40, false], store_email: [100, false], tax_no: [40, false],
                     bank_name: [60, false], bank_account: [60, false], bank_holder: [80, false], receipt_footer: [250, false] };
    Object.keys(textKeys).forEach(function (k) {
      if (p[k] !== undefined) { set[k] = str(p[k], textKeys[k][0], k === 'store_name' ? 'Nama toko' : 'Isian', textKeys[k][1]); }
    });
    if (p.tax_rate !== undefined) { set.tax_rate = String(num(p.tax_rate, 'Pajak', 0, 100)); }
    if (p.paper_width !== undefined) { set.paper_width = Number(p.paper_width) === 58 ? '58' : '80'; }
    if (p.show_logo_on_receipt !== undefined) { set.show_logo_on_receipt = p.show_logo_on_receipt ? '1' : '0'; }
    if (p.auto_print !== undefined) { set.auto_print = p.auto_print ? '1' : '0'; }
    if (p.inv_code !== undefined) {
      var code = str(p.inv_code, 10, 'Kode invoice', true);
      if (!/^[A-Za-z0-9]{1,10}$/.test(code)) { fail('Kode invoice hanya huruf/angka (contoh: 200).'); }
      set.inv_code = code;
    }
    if (p.inv_next !== undefined && Number(p.inv_next) !== cur.inv_next) {
      var nx = int(p.inv_next, 'Nomor urut invoice', 1, 999999);
      var yy = cur.inv_yy, maxSeq = 0;
      db.all('Transactions').forEach(function (t) {
        var m = /^(\d{2})-[^-]+-(\d+)$/.exec(t.invoice_no);
        if (m && m[1] === yy && Number(m[2]) > maxSeq) { maxSeq = Number(m[2]); }
      });
      if (nx <= maxSeq) { fail('Nomor urut harus lebih besar dari nomor terakhir yang sudah dipakai tahun ini (' + maxSeq + ').'); }
      set.inv_year = yy; set.inv_next = String(nx);
    }
    var kvNow = db.kv();
    function imageKeys(prefix) { var re = new RegExp('^' + prefix + '_\\d+$'); return Object.keys(kvNow).filter(function (k) { return re.test(k); }); }
    function putImage(prefix, data, maxLen, label) {
      var d = String(data);
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(d)) { fail('Format ' + label + ' harus PNG, JPG, atau WebP.'); }
      if (d.length > maxLen) { fail('Ukuran ' + label + ' terlalu besar. Gunakan gambar yang lebih kecil.'); }
      imageKeys(prefix).forEach(function (k) { del.push(k); });
      for (var i = 0, n = 0; i < d.length; i += 40000, n++) { set[prefix + '_' + n] = d.slice(i, i + 40000); }
      del = del.filter(function (k) { return !Object.prototype.hasOwnProperty.call(set, k); });
    }
    if (p.logo_delete) { imageKeys('store_logo').forEach(function (k) { del.push(k); }); }
    else if (p.logo) { putImage('store_logo', p.logo, 300000, 'logo'); }
    if (p.qris_delete) { imageKeys('qris_image').forEach(function (k) { del.push(k); }); }
    else if (p.qris) { putImage('qris_image', p.qris, 400000, 'gambar QRIS'); }
    db.kvWrite(set, del);
    return loadSettings();
  } };

  /* ================================================================
     LAPORAN
     ================================================================ */
  function normRange(p) {
    var today = fmtDate_(P.now());
    var from = isYmd_(p.from) ? p.from : today, to = isYmd_(p.to) ? p.to : today;
    if (to < from) { var t = from; from = to; to = t; }
    if (diffDays_(from, to) > 400) { fail('Rentang laporan maksimal 400 hari.'); }
    return { from: from, to: to };
  }
  function txInRange(r) {
    return db.all('Transactions').filter(function (t) { var d = t.date.slice(0, 10); return t.status === 'completed' && d >= r.from && d <= r.to; });
  }
  function itemsInRange(r) {
    return db.all('TxItems').filter(function (i) { var d = i.date.slice(0, 10); return d >= r.from && d <= r.to; });
  }
  function costByTx(items) {
    var m = {};
    items.forEach(function (i) { m[i.tx_id] = (m[i.tx_id] || 0) + i.cost * i.qty; });
    return m;
  }
  function netOf(t) { return t.subtotal - t.discount_amount; }

  A.dashboard = { roles: ['admin'], run: function (p) {
    var r = normRange(p);
    var txs = txInRange(r), items = itemsInRange(r), cost = costByTx(items);
    var k = { sales: 0, tx: txs.length, qty: 0, profit: 0, discount: 0, tax: 0 };
    var dayMap = {}, methods = {};
    var n = diffDays_(r.from, r.to);
    for (var d = 0; d <= n; d++) { var ds = addDays_(r.from, d); dayMap[ds] = { date: ds, sales: 0, tx: 0, qty: 0 }; }
    txs.forEach(function (t) {
      k.sales += t.grand_total; k.discount += t.discount_amount; k.tax += t.tax_amount;
      k.profit += netOf(t) - (cost[t.id] || 0);
      var dm = dayMap[t.date.slice(0, 10)]; dm.sales += t.grand_total; dm.tx += 1;
      var m = methods[t.method] || (methods[t.method] = { method: t.method, tx: 0, sales: 0 });
      m.tx += 1; m.sales += t.grand_total;
    });
    var prod = {}, byType = { barang: { qty: 0, sales: 0 }, jasa: { qty: 0, sales: 0 } };
    items.forEach(function (i) {
      k.qty += i.qty;
      dayMap[i.date.slice(0, 10)].qty += i.qty;
      var key = i.product_id;
      var e = prod[key] || (prod[key] = { product_id: i.product_id, name: i.name, type: i.type, qty: 0, sales: 0, profit: 0 });
      e.name = i.name; e.qty += i.qty; e.sales += i.subtotal; e.profit += i.subtotal - i.cost * i.qty;
      var bt = byType[i.type === 'jasa' ? 'jasa' : 'barang']; bt.qty += i.qty; bt.sales += i.subtotal;
    });
    var itemsOut = Object.keys(prod).map(function (x) { return prod[x]; }).sort(function (a, b) { return b.qty - a.qty || b.sales - a.sales; });

    // periode pembanding: rentang sama panjang tepat sebelum periode ini
    var len = n + 1, pr = { from: addDays_(r.from, -len), to: addDays_(r.from, -1) };
    var ptx = txInRange(pr), prevSales = 0;
    ptx.forEach(function (t) { prevSales += t.grand_total; });

    var low = db.all('Products').filter(function (x) { return x.track_stock && x.stock <= x.min_stock; })
      .sort(function (a, b) { return a.stock - b.stock; }).slice(0, 12)
      .map(function (x) { return { id: x.id, name: x.name, stock: x.stock, min_stock: x.min_stock, unit: x.unit }; });

    return {
      range: r, kpi: k, prev: { sales: prevSales, tx: ptx.length, from: pr.from, to: pr.to },
      daily: Object.keys(dayMap).sort().map(function (x) { return dayMap[x]; }),
      methods: Object.keys(methods).map(function (x) { return methods[x]; }).sort(function (a, b) { return b.sales - a.sales; }),
      items: itemsOut, byType: byType, low_stock: low
    };
  } };

  A.userReport = { roles: ['admin'], run: function (p) {
    var r = normRange(p);
    var txs = txInRange(r), items = itemsInRange(r), cost = costByTx(items);
    var users = db.all('Users'), evals = db.all('Evaluations').filter(function (e) { return e.from === r.from && e.to === r.to; });
    var map = {};
    function ensure(uid, name, username, role, active, deleted) {
      return map[uid] || (map[uid] = { user_id: uid, name: name, username: username, role: role, active: active, deleted: deleted,
        tx: 0, qty: 0, sales: 0, profit: 0, days: {}, first: '', last: '', prod: {}, daily: {} });
    }
    users.forEach(function (u) { ensure(u.id, u.full_name, u.username, u.role, u.active, false); });
    var total = { tx: 0, qty: 0, sales: 0, profit: 0 };
    txs.forEach(function (t) {
      var e = ensure(t.user_id, t.user_name, '', '', false, true);
      e.tx += 1; e.sales += t.grand_total; e.profit += netOf(t) - (cost[t.id] || 0);
      var d = t.date.slice(0, 10); e.days[d] = 1; e.daily[d] = (e.daily[d] || 0) + t.grand_total;
      if (!e.first || t.date < e.first) { e.first = t.date; }
      if (!e.last || t.date > e.last) { e.last = t.date; }
      total.tx += 1; total.sales += t.grand_total; total.profit += netOf(t) - (cost[t.id] || 0);
    });
    items.forEach(function (i) {
      var e = map[i.user_id]; if (!e) { return; }
      e.qty += i.qty; total.qty += i.qty;
      var x = e.prod[i.product_id] || (e.prod[i.product_id] = { name: i.name, type: i.type, qty: 0, sales: 0 });
      x.name = i.name; x.qty += i.qty; x.sales += i.subtotal;
    });
    var out = Object.keys(map).map(function (id) {
      var e = map[id], ev = evals.filter(function (x) { return x.user_id === e.user_id; })[0];
      var list = Object.keys(e.prod).map(function (k) { return e.prod[k]; }).sort(function (a, b) { return b.sales - a.sales; });
      return {
        user_id: e.user_id, name: e.name, username: e.username, role: e.role, active: e.active, deleted: e.deleted,
        tx: e.tx, qty: e.qty, sales: e.sales, profit: e.profit, avg: e.tx ? Math.round(e.sales / e.tx) : 0,
        days: Object.keys(e.days).length, first: e.first, last: e.last,
        share: total.sales ? e.sales / total.sales : 0,
        items: list, daily: Object.keys(e.daily).sort().map(function (d) { return { date: d, sales: e.daily[d] }; }),
        eval: ev ? { rating: ev.rating, bonus: ev.bonus, note: ev.note, updated_by: ev.updated_by, updated_at: ev.updated_at } : null
      };
    }).filter(function (e) { return !e.deleted || e.tx > 0; })
      .sort(function (a, b) { return b.sales - a.sales || a.name.localeCompare(b.name); });
    return { range: r, total: total, users: out };
  } };

  A.evalSave = { roles: ['admin'], write: true, run: function (p, me) {
    var r = normRange(p), uid = refId(p.user_id, 'User');
    var o = { user_id: uid, from: r.from, to: r.to, rating: int(p.rating || 0, 'Penilaian', 0, 5), bonus: num(p.bonus || 0, 'Bonus', 0, 1e12),
              note: str(p.note, 250, 'Catatan', false), updated_at: fmtDateTime_(P.now()), updated_by: me.full_name };
    var ex = db.all('Evaluations').filter(function (e) { return e.user_id === uid && e.from === r.from && e.to === r.to; })[0];
    if (ex) { db.update('Evaluations', ex.id, o); } else { db.insert('Evaluations', o); }
    return { rating: o.rating, bonus: o.bonus, note: o.note, updated_by: o.updated_by, updated_at: o.updated_at };
  } };

  /* ----- sinkronisasi offline (PWA/Android) ----- */
  A.syncPull = { roles: ['admin', 'kasir'], run: function (p, user) {
    // Catatan keamanan: baris Users disertakan APA ADANYA (termasuk salt+pass_hash yang
    // sudah di-hash) supaya perangkat bisa login walau sedang offline. Ini hanya tersimpan
    // di perangkat sendiri (IndexedDB), bukan dikirim ke pihak lain, dan memerlukan token
    // sesi yang valid untuk memanggil aksi ini.
    var days = int(p.days || 180, 'Hari', 1, 3650);
    var since = fmtDate_(new Date(P.now().getTime() - days * 86400000));
    var tx = db.all('Transactions').filter(function (t) { return t.date >= since; });
    var txIds = {}; tx.forEach(function (t) { txIds[t.id] = 1; });
    var items = db.all('TxItems').filter(function (i) { return txIds[i.tx_id]; });
    return {
      server_time: fmtDateTime_(P.now()), days: days,
      users: db.all('Users'), categories: db.all('Categories'), products: db.all('Products'), customers: db.all('Customers'),
      transactions: tx, tx_items: items, services: db.all('Services'),
      evaluations: user.role === 'admin' ? db.all('Evaluations') : [],
      kv: db.kv()
    };
  } };

  /* ================================================================
     PINTU MASUK
     ================================================================ */
  function handle(action, token, payload) {
    try {
      var a = A[action];
      if (!a) { fail('Aksi tidak dikenal.', 'NOACTION'); }
      var run = function () {
        var user = null;
        if (a.auth !== false) { user = authUser(token, a.roles); }
        return a.run(payload || {}, user);
      };
      var data = a.write ? P.lock(run) : run();
      return { ok: true, data: data };
    } catch (e) {
      if (e && e.isApp) { return { ok: false, error: e.message, code: e.code }; }
      if (P.log) { P.log(e); }
      return { ok: false, error: 'Terjadi kesalahan pada server: ' + (e && e.message ? e.message : e), code: 'SERVER' };
    }
  }

  /* ---------- data awal ---------- */
  function seedBase() {
    if (db.all('Users').length === 0) {
      var salt = newSalt();
      db.insert('Users', { username: 'admin', salt: salt, pass_hash: hashPw(salt, 'admin123'), full_name: 'Administrator', role: 'admin', active: true, last_login: '', created_at: fmtDateTime_(P.now()) });
    }
    var kv = db.kv(), set = {};
    Object.keys(SETTING_DEFAULTS).forEach(function (k) { if (kv[k] === undefined) { set[k] = SETTING_DEFAULTS[k]; } });
    if (Object.keys(set).length) { db.kvWrite(set, []); }
  }

  return {
    handle: handle, seedBase: seedBase,
    util: { computeTotals: computeTotals, invoiceNo: invoiceNo, hashPw: hashPw, newSalt: newSalt, fmtDate: fmtDate_, fmtDateTime: fmtDateTime_, addDays: addDays_, loadSettings: loadSettings, wib: wib_ }
  };
}
