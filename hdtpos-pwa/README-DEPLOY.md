# HDT POS — Panduan Pasang Versi Android/Offline (PWA)

Paket ini adalah versi HDT POS yang bisa **dipasang seperti aplikasi Android** (lewat Chrome
"Tambahkan ke layar utama") dan **tetap bisa dipakai walau tidak ada internet**. Saat internet
tersedia lagi, semua transaksi/produk/pelanggan/dll yang dibuat offline otomatis dikirim ke
Google Sheets, dan data terbaru dari Sheets otomatis ditarik ke perangkat.

## Kenapa perlu dua langkah pasang (bukan cuma buka link Apps Script)?

Google Apps Script (tempat database Google Sheets-nya berjalan) **tidak bisa** meng-host
"Service Worker" — komponen wajib yang membuat aplikasi web bisa dipasang & dibuka offline.
Jadi arsitekturnya dipisah jadi dua bagian, seperti aplikasi Android pada umumnya yang punya
"server" dan "aplikasi":

1. **Backend (server data)** — proyek Apps Script Anda yang sudah ada (Code.gs, Core.gs,
   Google Sheets "HDT POS Database"). Ini yang menyimpan data permanen.
2. **Aplikasi (folder `hdtpos-pwa` ini)** — file HTML/JS statis yang di-hosting di layanan
   hosting statis gratis (disarankan **GitHub Pages**), lalu aplikasi ini berbicara ke
   backend Apps Script lewat internet (`fetch`), bukan lewat `google.script.run`.

Setelah dipasang sekali, aplikasi tetap berjalan biarpun internet mati — karena file
aplikasinya sendiri sudah tersimpan di perangkat (lewat Service Worker), dan datanya
tersimpan di IndexedDB (penyimpanan lokal browser).

## Langkah 1 — Deploy ulang backend Apps Script

1. Buka proyek Apps Script HDT POS Anda (isi `Code.gs`, `Core.gs`, `Index.html`, dll sudah
   diperbarui di paket `hdtpos-gas` yang menyertai README ini — timpa file lama dengan yang baru).
2. Klik **Deploy → Manage deployments** → pilih deployment Web App yang aktif → ikon pensil
   (Edit) → pada "Version" pilih **New version** → **Deploy**.
   - Kalau belum pernah deploy sebagai Web App: **Deploy → New deployment → Web app**,
     "Execute as": **Me**, "Who has access": **Anyone** (atau "Anyone with Google account"
     sesuai kebutuhan Anda) → **Deploy**.
3. Salin URL Web App yang diakhiri `/exec`. Contoh:
   `https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxx/exec`
   URL inilah yang nanti dimasukkan ke aplikasi PWA di Langkah 3.

> Aplikasi lama (dibuka langsung lewat URL `/exec` di browser) **tetap berfungsi seperti
> biasa** untuk yang belum butuh mode offline — perubahan pada Code.gs/Core.gs bersifat
> tambahan saja (menambah `doPost`/`syncPull`), tidak mengubah perilaku lama.

## Langkah 2 — Hosting folder `hdtpos-pwa` (disarankan: GitHub Pages, gratis)

1. Buat repository baru di GitHub (boleh privat), misalnya `hdt-pos-app`.
2. Unggah **seluruh isi folder `hdtpos-pwa`** (index.html, manifest.json, sw.js, folder
   `icons/`) ke repository tersebut — root repo, bukan di dalam subfolder.
3. Buka **Settings → Pages** pada repo tsb → Source: pilih branch `main` folder `/ (root)` →
   Save.
4. Setelah beberapa menit, GitHub akan memberi alamat seperti:
   `https://<username-anda>.github.io/hdt-pos-app/`
   Alamat inilah yang dibuka kasir sehari-hari (boleh dibuatkan pintasan/QR code).

   *Alternatif hosting statis lain yang juga gratis & bisa dipakai: Cloudflare Pages,
   Netlify, Firebase Hosting — caranya serupa: unggah isi folder `hdtpos-pwa` apa adanya.*

## Langkah 3 — Pengaturan pertama kali di aplikasi

1. Buka alamat GitHub Pages (atau hosting lain) tadi di **Chrome** (HP Android atau
   komputer).
2. Aplikasi akan menampilkan layar **"Pengaturan awal"** → klik **Atur alamat server** →
   tempel URL `/exec` dari Langkah 1 → **Simpan**.
3. Masuk (login) dengan akun HDT POS seperti biasa — **login pertama kali wajib saat ada
   internet**, supaya data awal (produk, pelanggan, user, dll) tersalin ke perangkat.
4. Setelah berhasil masuk, aplikasi siap dipakai. Mulai saat ini, aplikasi bisa dibuka dan
   dipakai walau HP dalam mode pesawat / tidak ada sinyal sama sekali.

## Langkah 4 — Pasang ke layar utama (jadi seperti aplikasi Android)

Di Chrome Android: buka menu titik tiga (⋮) → **"Tambahkan ke Layar utama"** / **"Instal
aplikasi"**. Ikon HDT POS akan muncul di layar utama HP seperti aplikasi biasa, terbuka
tanpa address bar browser.

Di komputer (Chrome/Edge): akan muncul ikon "Instal" di kanan address bar.

## Bagaimana cara kerja mode offline-nya?

- **Semua menu bisa dipakai offline** — kasir, service, produk, pelanggan, user, pengaturan,
  laporan (laporan memakai data 180 hari terakhir yang sudah tersinkron ke perangkat).
- Setiap kali ada aksi (checkout, simpan produk, dll), perubahan **langsung tersimpan di
  perangkat** (jadi kasir tidak perlu menunggu internet), lalu antre untuk dikirim ke Google
  Sheets segera setelah internet tersedia lagi.
- Pojok kanan atas menampilkan status sinkronisasi:
  - 🟢 **Tersinkron** — semua data sudah terkirim ke server.
  - 🔵 **N menunggu sinkron** — ada N perubahan yang masih menunggu internet.
  - 🟠 **Offline** — tidak ada internet saat ini; aplikasi tetap bisa dipakai penuh.
  - 🔴 **Perlu masuk ulang** — biasanya karena sempat login secara offline lalu sesi lokal
    itu tidak dikenali server; klik lencana ini lalu masuk ulang saat online untuk
    melanjutkan sinkronisasi (data yang sudah dibuat offline tidak hilang, hanya menunggu).
  - Lencana ini juga bisa diklik kapan saja untuk memaksa sinkronisasi sekarang.
- Data yang dibuat sepenuhnya offline (misalnya pelanggan baru lalu langsung dipakai untuk
  transaksi, semuanya sebelum ada internet) tetap saling terhubung dengan benar; begitu
  tersambung internet, ID sementara otomatis diganti dengan ID asli dari server.
- Kalau login dilakukan saat **offline** (memakai akun yang sebelumnya pernah dipakai online
  di perangkat yang sama), aplikasi memakai kata sandi yang terakhir tersinkron. Jika kata
  sandi baru saja diganti di perangkat lain, perangkat ini perlu online sekali untuk
  menyegarkan data.

## Mengganti alamat server / pindah ke deployment baru

Buka menu akun (pojok kanan atas setelah masuk) → **Alamat server** → ubah URL → Simpan.

## Mengganti ikon / nama aplikasi

Ikon ada di folder `icons/` (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`) dan
diatur lewat `manifest.json`. Timpa file PNG tersebut dengan logo baru (ukuran sama) lalu
unggah ulang ke hosting untuk mengubah ikon yang tampil di layar utama HP.
