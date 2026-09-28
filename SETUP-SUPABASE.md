# Setup HDT POS dengan Supabase + GitHub

Panduan singkat menjalankan HDT POS dengan database Postgres (Supabase)
dan deploy otomatis lewat GitHub Actions. Detail lebih panjang (kenapa
setiap keputusan diambil) ada di Claude Doc yang sudah dibuat sebelumnya;
file ini fokus ke langkah-langkah eksekusinya.

## 0. Struktur file yang ditambahkan

```
supabase/
  schema.sql                    <- jalankan sekali di SQL Editor Supabase
  config.toml
  .env.local.example             <- contoh env untuk tes lokal
  functions/
    api/
      Core.gs                    <- salinan persis Core.gs (jangan diedit di sini)
      core-loader.js
      platform.js
      index.ts                   <- entry point Edge Function
      README.md                  <- detail teknis + cara tes lokal
.github/
  workflows/
    deploy.yml                   <- auto-deploy saat push ke main
```

## 1. Buat project Supabase

1. Daftar/masuk ke https://supabase.com, buat project baru (pilih region
   Singapore supaya latensi ke Indonesia rendah).
2. Simpan **Project URL** dan **anon key** (Settings → API) — anon key
   TIDAK dipakai di backend, hanya kalau nanti perlu akses langsung dari
   browser (tidak digunakan di setup ini).
3. Simpan juga **service_role key** (Settings → API → "service_role
   secret") — ini kunci sakti yang HANYA boleh hidup di server/Edge
   Function, jangan pernah taruh di kode frontend atau commit ke git.

## 2. Jalankan schema.sql

Dashboard Supabase → SQL Editor → New query → tempel isi
`supabase/schema.sql` → Run. Ini membuat semua tabel (setara 1:1 dengan
sheet-sheet di Google Sheets sekarang), plus baris pengaturan default.

## 3. Push project ini ke GitHub

```bash
cd /path/ke/project
git init
git add .
git commit -m "Migrasi HDT POS ke Supabase"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

Lalu di GitHub: Settings → Secrets and variables → Actions → tambahkan:

| Secret | Isi |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | dari https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | id project (terlihat di URL dashboard project Anda) |

Dan aktifkan GitHub Pages: Settings → Pages → Source → "GitHub Actions".

Setelah ini, setiap `git push` ke `main` otomatis: (a) deploy ulang Edge
Function ke Supabase, (b) publish `hdtpos-pwa/` ke GitHub Pages.

## 4. Deploy Edge Function (bisa manual dulu sebelum push pertama)

Perlu [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <PROJECT_REF_ANDA>
supabase functions deploy api --project-ref <PROJECT_REF_ANDA>
supabase secrets set HMAC_SECRET="string-acak-panjang-milik-anda" --project-ref <PROJECT_REF_ANDA>
```

Catat URL yang muncul:
`https://<PROJECT_REF_ANDA>.supabase.co/functions/v1/api`

Detail cara tes lokal (`supabase functions serve`) ada di
`supabase/functions/api/README.md`.

## 5. Arahkan frontend ke Edge Function

Tidak ada kode PWA yang perlu diubah — `serverCall()` di
`hdtpos-pwa/index.html` sudah generik (fetch biasa, bukan
`google.script.run`). Cukup:

1. Buka PWA / demo di browser.
2. Masuk ke menu **Pengaturan → Web App URL** (atau sejenisnya di UI
   yang ada sekarang).
3. Ganti URL Apps Script lama dengan URL Edge Function dari langkah 4.
4. Simpan, lalu login memakai admin bawaan: `admin` / `admin123` (dibuat
   otomatis saat tabel Users masih kosong — segera ganti password ini
   setelah login pertama).

## 6. Migrasi data lama dari Google Sheets (kalau perlu)

Kalau sudah ada data produksi di Google Sheets yang mau dipindah:

1. Di Google Sheets, File → Download → CSV, untuk tiap sheet (Users,
   Categories, Products, Customers, Transactions, TxItems, Evaluations,
   StockLog, Settings, Services).
2. Di Supabase Dashboard → Table Editor → pilih tabel yang sepadan →
   Insert → Import data from CSV.
3. Urutan import HARUS mengikuti urutan ini (karena ada foreign key):
   `users` → `categories` → `products` → `customers` → `transactions` →
   `tx_items` → `evaluations` → `stock_log` → `services` → (`settings`
   sudah terisi default, timpa kalau perlu).
4. Setelah semua tabel terisi, jalankan query ini di SQL Editor supaya
   penghitung id aplikasi tidak bentrok dengan data lama (tidak wajib,
   tapi aman untuk dijalankan — aplikasi menghitung id maksimum sendiri
   tiap request, jadi ini murni sanity-check, bukan keharusan):

   ```sql
   select 'users' t, max(id) from users
   union all select 'products', max(id) from products
   union all select 'transactions', max(id) from transactions;
   ```

## Ringkasan keamanan

- `service_role` key hanya ada di: Supabase secrets (untuk Edge Function)
  dan GitHub Secrets (untuk deploy). Tidak pernah di kode frontend.
- Semua tabel RLS-enabled tanpa policy → akses langsung dari browser
  dengan `anon` key selalu ditolak. Satu-satunya pintu masuk adalah Edge
  Function `api`.
- `verify_jwt = false` di `supabase/config.toml` sengaja diset supaya
  Edge Function bisa dipanggil langsung dengan skema token buatan
  sendiri (yang sudah ada di Core.gs — `sign()`/`hashPw()`), sama seperti
  sekarang di Apps Script. Ini bukan lubang keamanan karena tidak ada
  data yang bisa diakses tanpa lewat `handle()` di Core.gs, yang tetap
  mengecek token itu sendiri.
