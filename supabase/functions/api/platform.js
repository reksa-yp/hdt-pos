// platform.js
//
// Adapter Postgres yang mengisi objek "P" (platform) yang sama dipakai
// Core.gs — persis seperti gasPlatform_() di Code.gs mengisinya dengan
// Google Sheets, dan seperti platform lokal di hdtpos-pwa/index.html
// mengisinya dengan IndexedDB.
//
// PENTING — kenapa bentuknya "ambil semua dulu, lalu simpan balik":
// Core.gs menulis semua operasi database secara SYNCHRONOUS (khas Apps
// Script: SpreadsheetApp.getRange().getValues() langsung mengembalikan
// nilai). Query ke Postgres/Supabase selalu ASYNCHRONOUS (network call,
// mengembalikan Promise). Supaya Core.gs bisa dipakai apa adanya tanpa
// disisipi "await" di tengah-tengahnya, satu request API di sini:
//   1) mengambil (await) SEMUA tabel dari Postgres ke memori (prefetchAll),
//   2) menjalankan Core.gs sepenuhnya di memori — synchronous, cepat,
//      persis seperti di atas Sheets,
//   3) menyimpan (await) semua perubahan yang terjadi balik ke Postgres
//      (flush), dalam urutan yang sama seperti terjadinya.
//
// Untuk toko kecil-menengah ini cukup cepat (semua tabel biasanya jauh
// di bawah puluhan ribu baris). Kalau nanti riwayat transaksi sudah
// sangat besar, langkah lanjutannya adalah memuat tabel secara selektif
// per aksi, bukan mengambil semuanya di setiap request.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sha256 as sha256Sync } from 'npm:js-sha256@0.11.0';

export const TABLES = {
  Users: 'users', Categories: 'categories', Products: 'products', Customers: 'customers',
  Transactions: 'transactions', TxItems: 'tx_items', Evaluations: 'evaluations',
  StockLog: 'stock_log', Settings: 'settings', Services: 'services', Quotes: 'quotes'
};

// Tabel yang ditambahkan belakangan. Kalau tabelnya belum dibuat di Supabase
// (schema.sql terbaru belum dijalankan ulang), fitur lain tetap jalan — hanya
// fitur tabel itu yang menolak menyimpan dengan pesan yang jelas.
const OPTIONAL_TABLES = { Quotes: 1 };
function isMissingTable(error) {
  const m = String((error && (error.code + ' ' + error.message)) || '');
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(m);
}

// "from"/"to" adalah kata kunci SQL, jadi di Postgres disimpan sebagai
// period_from/period_to (lihat schema.sql). Core.gs sendiri tetap memakai
// nama field aslinya (from/to) — pemetaan dua arah ditangani di sini saja.
const FIELD_ALIAS = { Evaluations: { from: 'period_from', to: 'period_to' } };

function toDb(t, obj) {
  const alias = FIELD_ALIAS[t];
  if (!alias) return obj;
  const out = {};
  Object.keys(obj).forEach((k) => { out[alias[k] || k] = obj[k]; });
  return out;
}
function fromDb(t, row) {
  const alias = FIELD_ALIAS[t];
  if (!alias || !row) return row;
  const rev = {};
  Object.entries(alias).forEach(([k, v]) => { rev[v] = k; });
  const out = {};
  Object.keys(row).forEach((k) => { out[rev[k] || k] = row[k]; });
  return out;
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

// PostgREST mengembalikan kolom numeric sebagai string (supaya presisi
// desimal tidak hilang lewat JSON) — dikembalikan ke Number di sini,
// persis seperti fromCell() di Code.gs (gasPlatform_) melakukannya untuk
// nilai yang dibaca dari Google Sheets.
function coerce(t, row, SCHEMA) {
  if (!row) return row;
  const cols = SCHEMA[t];
  if (!cols) return row;
  const out = Object.assign({}, row);
  cols.forEach(([name, type]) => {
    if (out[name] === null || out[name] === undefined) {
      out[name] = type === 'n' ? 0 : type === 'b' ? false : '';
      return;
    }
    if (type === 'n') { out[name] = Number(out[name]); }
    else if (type === 'b') { out[name] = out[name] === true || out[name] === 't' || out[name] === 1 || out[name] === '1'; }
  });
  return out;
}

export function makeClient() {
  return createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

export async function prefetchAll(sb, SCHEMA) {
  const names = Object.keys(TABLES);
  const results = await Promise.all(names.map((t) => sb.from(TABLES[t]).select('*')));
  const tables = {}, nextId = {}, missing = {};
  names.forEach((t, i) => {
    const { error } = results[i];
    let data = results[i].data;
    if (error && OPTIONAL_TABLES[t] && isMissingTable(error)) { missing[t] = 1; data = []; }
    else if (error) { throw new Error('Gagal memuat tabel ' + t + ': ' + error.message); }
    tables[t] = data.map((r) => coerce(t, fromDb(t, r), SCHEMA));
    nextId[t] = tables[t].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  });
  const { data: kvRows, error: kvErr } = await sb.from('settings').select('key,value');
  if (kvErr) { throw new Error('Gagal memuat settings: ' + kvErr.message); }
  const kv = {};
  kvRows.forEach((r) => { kv[r.key] = r.value == null ? '' : String(r.value); });
  return { tables, kv, nextId, missing, writes: [] };
}

function makeDb(store) {
  return {
    all(t) { return store.tables[t].map(clone); },
    insert(t, o) {
      const id = ++store.nextId[t];
      const full = Object.assign(clone(o), { id });
      store.tables[t].push(full);
      store.writes.push({ op: 'insert', table: t, row: clone(full) });
      return clone(full);
    },
    insertMany(t, arr) {
      const self = this;
      return arr.map((o) => self.insert(t, o));
    },
    update(t, id, patch) {
      const row = store.tables[t].find((r) => r.id === id);
      if (!row) { return null; }
      Object.assign(row, patch);
      store.writes.push({ op: 'update', table: t, id: id, patch: clone(patch) });
      return clone(row);
    },
    removeMany(t, ids) {
      const before = store.tables[t].length;
      store.tables[t] = store.tables[t].filter((r) => ids.indexOf(r.id) < 0);
      const removed = before - store.tables[t].length;
      if (removed) { store.writes.push({ op: 'delete', table: t, ids: ids.slice() }); }
      return removed;
    },
    kv() { return Object.assign({}, store.kv); },
    kvWrite(set, del) {
      Object.keys(set).forEach((k) => { store.kv[k] = String(set[k]); });
      (del || []).forEach((k) => { delete store.kv[k]; });
      store.writes.push({ op: 'kvWrite', set: Object.assign({}, set), del: (del || []).slice() });
    }
  };
}

export async function flush(sb, store) {
  for (const w of store.writes) {
    if (w.table && store.missing && store.missing[w.table]) {
      throw new Error('Tabel "' + TABLES[w.table] + '" belum ada di Supabase. Jalankan ulang supabase/schema.sql di SQL Editor.');
    }
    if (w.op === 'insert') {
      const { error } = await sb.from(TABLES[w.table]).insert(toDb(w.table, w.row));
      if (error) { throw new Error('Gagal menyimpan ke ' + w.table + ': ' + error.message); }
    } else if (w.op === 'update') {
      const { error } = await sb.from(TABLES[w.table]).update(toDb(w.table, w.patch)).eq('id', w.id);
      if (error) { throw new Error('Gagal memperbarui ' + w.table + ': ' + error.message); }
    } else if (w.op === 'delete') {
      const { error } = await sb.from(TABLES[w.table]).delete().in('id', w.ids);
      if (error) { throw new Error('Gagal menghapus dari ' + w.table + ': ' + error.message); }
    } else if (w.op === 'kvWrite') {
      if (Object.keys(w.set).length) {
        const rows = Object.keys(w.set).map((k) => ({ key: k, value: w.set[k] }));
        const { error } = await sb.from('settings').upsert(rows);
        if (error) { throw new Error('Gagal menyimpan settings: ' + error.message); }
      }
      if (w.del.length) {
        const { error } = await sb.from('settings').delete().in('key', w.del);
        if (error) { throw new Error('Gagal menghapus settings: ' + error.message); }
      }
    }
  }
}

export function makePlatform(store, env) {
  return {
    db: makeDb(store),
    sha256: (s) => sha256Sync(s),
    now: () => new Date(),
    // Penguncian lintas-request (supaya dua checkout bersamaan tidak
    // tabrakan) ditangani DI LUAR Core.gs, lewat acquireLock/releaseLock
    // di bawah — dipanggil dari index.ts sebelum prefetch dan sesudah
    // flush. Di sini cukup jalankan fn() langsung, sama seperti platform
    // lokal PWA (IndexedDB) melakukannya untuk alasan yang sama.
    lock: (fn) => fn(),
    secret: () => env.HMAC_SECRET,
    cacheGet: () => null,
    cachePut: () => {},
    log: (e) => console.error(e)
  };
}

// Kunci sederhana berbasis tabel (bukan koneksi Postgres persisten, supaya
// tetap jalan lewat REST/PostgREST biasa). Kunci dianggap basi setelah 30
// detik, supaya proses yang gagal di tengah jalan tidak mengunci selamanya.
export async function acquireLock(sb, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const staleCutoff = new Date(Date.now() - 30000).toISOString();
    const { data, error } = await sb.from('_locks')
      .update({ locked_at: new Date().toISOString() })
      .eq('key', 'global')
      .or('locked_at.is.null,locked_at.lt.' + staleCutoff)
      .select();
    if (error) { throw new Error('Gagal mengunci: ' + error.message); }
    if (data && data.length) { return; }
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  }
  throw new Error('Server sedang sibuk, coba lagi sebentar lagi.');
}
export async function releaseLock(sb) {
  await sb.from('_locks').update({ locked_at: null }).eq('key', 'global');
}
