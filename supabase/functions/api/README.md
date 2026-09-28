# HDT POS — Edge Function API (Supabase)

Fungsi ini menggantikan `apiCall()` di Code.gs (Apps Script). Menerima
request yang persis sama (`{action, token, payload}`) dan mengembalikan
respons yang persis sama (`{ok, data}` atau `{ok:false, error, code}`) —
jadi frontend (PWA maupun demo browser) tidak perlu tahu bedanya.

## Isi folder

- `Core.gs` — salinan PERSIS (byte-for-byte) dari `hdtpos-gas/Core.gs`,
  disimpan di sini hanya sebagai REFERENSI/untuk diffing. Jangan diedit
  di sini, dan **tidak dipakai langsung saat deploy** (lihat catatan
  `core-src.js` di bawah). Kalau ada perubahan logika bisnis di GAS,
  salin ulang file ini (timpa), lalu jalankan `generate-core-src.py`
  (lihat di bawah) sebelum deploy ulang.
- `core-src.js` — **inilah yang benar-benar dipakai saat runtime**: isi
  `Core.gs` disematkan di sini sebagai teks base64 di dalam modul JS.
  Ini WAJIB (bukan gaya penulisan saja) — `supabase functions deploy`
  membundel function berdasarkan import graph, jadi file yang cuma
  dibaca lewat `Deno.readTextFile('./Core.gs')` saat runtime TIDAK ikut
  terbawa ke server produksi (walau jalan normal saat `supabase
  functions serve` lokal, karena lokal masih baca dari disk asli) —
  menyebabkan error `path not found: .../Core.gs`. Kalau `Core.gs`
  diperbarui, generate ulang file ini dengan:
  ```
  python3 supabase/functions/api/generate-core-src.py
  ```
- `generate-core-src.py` — skrip generator `core-src.js` di atas.
- `core-loader.js` — mengambil isi `Core.gs` dari `core-src.js` lalu
  menjalankannya, supaya `Core.gs` tidak perlu diubah sama sekali
  (tidak ada `export` ditambahkan) untuk jalan di Deno.
- `platform.js` — adaptor Postgres yang mengisi objek `P` yang dibutuhkan
  `createBackend_(P)` di Core.gs (db, sha256, now, lock, secret, cache, log).
- `index.ts` — titik masuk HTTP (`Deno.serve`). Alur tiap request:
  kunci → ambil semua tabel → jalankan Core.gs di memori → simpan balik →
  lepas kunci.

**Penting:** setiap kali `Core.gs` diperbarui, jalankan
`generate-core-src.py` SEBELUM `supabase functions deploy` — kalau
lupa, Edge Function akan tetap menjalankan versi `Core.gs` yang lama.

## Menjalankan & mencoba secara lokal

Perlu [Supabase CLI](https://supabase.com/docs/guides/cli) terpasang.

```bash
supabase login
supabase link --project-ref <PROJECT_REF_ANDA>

# jalankan lokal (butuh Docker aktif)
supabase start
supabase functions serve api --env-file supabase/.env.local
```

Isi `supabase/.env.local` (jangan pernah commit file ini — sudah ada di
`.gitignore`):

```
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key dari `supabase status`>
HMAC_SECRET=ganti-dengan-string-acak-panjang
```

Uji dengan curl (contoh: login dengan admin bawaan admin/admin123 yang
dibuat otomatis oleh `seedBase()` saat tabel Users masih kosong):

```bash
curl -X POST http://localhost:54321/functions/v1/api \
  -H "Content-Type: application/json" \
  -d '{"action":"login","token":"","payload":{"username":"admin","password":"admin123"}}'
```

## Deploy ke Supabase (production)

```bash
supabase functions deploy api --project-ref <PROJECT_REF_ANDA>
```

Lalu set secret di dashboard Supabase (Project Settings → Edge Functions
→ Secrets), atau lewat CLI:

```bash
supabase secrets set HMAC_SECRET="string-acak-panjang-milik-anda" --project-ref <PROJECT_REF_ANDA>
```

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di dalam
Edge Function tanpa perlu diset manual (disuntikkan Supabase sendiri).

URL Edge Function yang jadi setelah deploy:

```
https://<PROJECT_REF_ANDA>.supabase.co/functions/v1/api
```

URL inilah yang dimasukkan ke pengaturan "Web App URL" di PWA (menu
Pengaturan) atau demo browser — menggantikan URL Apps Script lama.

## Catatan keamanan

- `SUPABASE_SERVICE_ROLE_KEY` melewati Row Level Security sepenuhnya.
  Kunci ini HANYA boleh ada di sisi server: environment variable Edge
  Function / GitHub Secrets. Jangan pernah menaruhnya di kode frontend,
  file yang di-commit, atau dikirim ke browser.
- Semua tabel di `schema.sql` sudah `enable row level security` tanpa
  policy sama sekali — artinya akses langsung dari browser (pakai
  `anon` key) akan selalu ditolak. Satu-satunya jalan masuk yang sah
  adalah lewat Edge Function ini.
