// index.ts
//
// Titik masuk Edge Function. Alurnya untuk SETIAP request:
//   1) kunci (acquireLock) supaya tidak tabrakan dengan request lain,
//   2) ambil semua tabel dari Postgres ke memori (prefetchAll),
//   3) jalankan Core.gs apa adanya, synchronous, di memori (backend.handle),
//   4) simpan balik semua perubahan ke Postgres (flush),
//   5) lepas kunci (releaseLock) — selalu, bahkan kalau terjadi error.
//
// Core.gs sendiri TIDAK diubah sama sekali — lihat core-loader.js.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadCore } from './core-loader.js';
import { prefetchAll, flush, makePlatform, acquireLock, releaseLock } from './platform.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Core.gs "dijalankan" sekali saja lalu dipakai ulang (cold-start Deno
// saja yang men-decode dan mengeksekusinya; request berikutnya di
// instance yang sama pakai cache ini).
let corePromise = null;
function getCore() {
  if (!corePromise) corePromise = loadCore();
  return corePromise;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed', code: 'BAD' }, 405);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );

  let locked = false;
  try {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ ok: false, error: 'Data yang dikirim tidak valid.', code: 'BAD' });
    }
    const action = String(body.action || '');
    const token = String(body.token || '');
    const payload = body.payload || {};

    const { createBackend_, SCHEMA } = await getCore();

    await acquireLock(sb);
    locked = true;

    const store = await prefetchAll(sb, SCHEMA);
    const env = { HMAC_SECRET: Deno.env.get('HMAC_SECRET') || 'hdt-pos-default-secret' };
    const P = makePlatform(store, env);
    const backend = createBackend_(P);

    // Sama seperti seedBase() dipanggil di apiCall() (Code.gs) setiap kali —
    // di sini cukup jalankan sekali saat tabel Users masih kosong (setup awal).
    if (store.tables.Users.length === 0) {
      backend.seedBase();
    }

    const result = backend.handle(action, token, payload);

    await flush(sb, store);

    return json(result);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: 'Kesalahan server: ' + (e && e.message ? e.message : String(e)), code: 'SERVER' });
  } finally {
    if (locked) {
      try { await releaseLock(sb); } catch (e2) { console.error('gagal melepas lock', e2); }
    }
  }
});
