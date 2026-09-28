# HDT POS untuk Google Apps Script — Panduan Pemasangan

Aplikasi kasir yang berjalan di **Google Apps Script**, dengan **Google Sheets** sebagai database. Bisa dibuka dari PC, tablet, atau HP mana pun selama ada internet. Tidak perlu hosting, XAMPP, atau MySQL.

## Isi paket

| File | Fungsi |
|---|---|
| `Code.gs` | Pintu masuk web app + penghubung ke Google Sheets |
| `Core.gs` | Seluruh logika bisnis (login, kasir, invoice, laporan) |
| `Index.html` | Tampilan aplikasi |
| `appsscript.json` | Pengaturan proyek (zona waktu WIB, akses web app) |
| `demo/HDT-POS-demo.html` | Demo lengkap, cukup klik dua kali — tanpa Google |

## Langkah pemasangan (±10 menit)

**1. Buat database (Google Sheet)**
Buka [sheets.new](https://sheets.new), beri nama **HDT POS Database**. Jangan isi apa pun; tabel dibuat otomatis.

**2. Buka Apps Script dari Sheet tersebut**
Menu **Ekstensi → Apps Script**. Proyek ini otomatis terikat ke Sheet Anda. Ubah nama proyek menjadi *HDT POS*.

**3. Tempel kode**
- Di editor sudah ada `Code.gs`. Hapus isinya, lalu tempel seluruh isi **Code.gs** dari paket ini.
- Klik **+** di samping "Files" → **Script** → beri nama `Core` → tempel isi **Core.gs**.
- Klik **+** → **HTML** → beri nama `Index` → tempel isi **Index.html**.
  (Buka file dengan Notepad → Ctrl+A → Ctrl+C. Nama file harus persis `Code`, `Core`, `Index`.)

**4. Pasang pengaturan proyek**
Klik ikon roda gigi (**Project Settings**) → centang **Show "appsscript.json" manifest file in editor**. Kembali ke Editor, buka `appsscript.json`, ganti isinya dengan **appsscript.json** dari paket.

**5. Jalankan setup satu kali**
Pilih fungsi **`setup`** pada menu di atas editor → **Run**. Pertama kali akan muncul izin akses:
*Review permissions* → pilih akun Google Anda → *Advanced* → *Go to HDT POS (unsafe)* → *Allow*.
(Peringatan ini normal untuk script buatan sendiri.) Setelah selesai, log menampilkan **SELESAI** dan Sheet Anda berisi tab Users, Products, Customers, Transactions, dst.

*(Opsional)* Jalankan **`isiDataContoh`** untuk mengisi 4 produk dan 1 pelanggan contoh.

**6. Terbitkan sebagai web app**
**Deploy → New deployment** → ikon roda gigi → **Web app**:
- *Execute as*: **Me**
- *Who has access*: **Anyone**
→ **Deploy** → salin **Web app URL** (berakhiran `/exec`).

> "Anyone" hanya berarti kasir tidak perlu akun Google. Aplikasi tetap meminta **username & password**, dan data di Sheet hanya bisa diakses lewat aplikasi.

**7. Masuk pertama kali**
Buka URL tadi → login **admin / admin123** → segera ganti password (menu nama Anda di kanan atas → *Ganti password*).

**8. Isi Pengaturan** (menu *Pengaturan*)
Nama usaha, alamat, NPWP, telepon, email, **logo** (unggah file yang lebar minimal 600 piksel; ruang kosong di tepinya dipangkas otomatis), **nama bank / no. rekening / atas nama**, pajak (0 bila tanpa PPN), dan kertas struk.
Untuk **melanjutkan nomor invoice dari sistem lama**, isi *Nomor urut berikutnya* — misalnya contoh invoice `26-200-000003` berarti isi **4**.

**9. Tambah data**
*Produk* (barang / jasa, stok, harga modal), *Pelanggan*, dan *Pengguna* (kasir Anda).

**10. Pasang di perangkat kasir**
Buka URL di Chrome → simpan bookmark, atau **⋮ → Tambahkan ke layar utama / Instal aplikasi** agar seperti aplikasi biasa.

## Memperbarui aplikasi di kemudian hari
Setelah mengubah kode, klik **Deploy → Manage deployments →** ikon pensil → **Version: New version → Deploy**. URL tetap sama. (Hanya menyimpan file **tidak** mengubah web app yang sudah terbit.)
Jika pembaruan menyertakan `Core.gs`, tempel juga isinya ke file **Core** sebelum membuat versi baru.

## Fitur & cara pakainya

| Kebutuhan | Di mana |
|---|---|
| Invoice A4 / PDF khusus pelanggan terdaftar (tunai / transfer) | Kasir: pilih pelanggan di keranjang → bayar → tombol **Invoice / PDF**. Juga dari menu **Riwayat**. Klik *Cetak / Simpan PDF* lalu pilih printer atau *Save as PDF*. |
| Nomor invoice otomatis | Format `TAHUN-KODE-URUTAN`, mis. `26-200-000004`. Urutan kembali ke 1 tiap tahun baru; kode & nomor awal bisa diatur. |
| Tambah / hapus pelanggan, tandai & hapus banyak | **Pelanggan** — centang baris atau kotak di header untuk pilih semua, lalu *Hapus terpilih*. |
| Tambah / hapus produk, tandai & hapus banyak | **Produk** — sama. Ada jenis *Barang* (stok dilacak) dan *Jasa*. |
| Tambah / hapus pengguna, dua tingkat wewenang | **Pengguna** — *Kasir* (hanya layar kasir + riwayat miliknya) dan *Kasir Admin* (semua fitur). Wewenang dicek di server, bukan hanya disembunyikan di layar. |
| Pembayaran QRIS | **Pengaturan → Pembayaran QRIS**: unggah gambar QRIS toko (JPG/PNG). Saat kasir memilih *QRIS*, gambar tampil di layar untuk di-scan pelanggan. Ini QRIS statis, jadi kasir memastikan dana masuk lalu menekan *Pembayaran sudah diterima*. |
| Rekap penjualan & barang/jasa terjual | **Dashboard** — pilih periode; ada tombol *Cetak rekap*. |
| Rekap per user, penilaian, bonus | **Rekap User** — ranking, rincian per kasir, penilaian bintang, bonus, catatan, dan *Cetak laporan* (dengan kolom tanda tangan). |

## Catatan penting

- **Cetak**: memakai dialog cetak browser. Untuk printer thermal, pilih kertas 58 / 80 mm. Agar struk langsung tercetak tanpa dialog, jalankan Chrome dengan opsi `--kiosk-printing` dan aktifkan *Cetak struk otomatis* di Pengaturan.
- **Backup**: data ada di Google Sheet Anda. Buat salinan berkala lewat **File → Buat salinan**. Jangan bagikan Sheet ke kasir; cukup bagikan URL aplikasi.
- **Kecepatan**: tiap aksi menghubungi Google (±0,5–2 detik). Sangat memadai untuk toko kecil–menengah; Sheet nyaman sampai puluhan ribu transaksi.
- **Sesi login**: 12 jam. Ganti password atau nonaktifkan akun akan langsung mengeluarkan akun itu.
- **Salah password 5×** mengunci akun tersebut 10 menit.

## Jika ada masalah

| Gejala | Solusi |
|---|---|
| Halaman putih / *Script function not found: doGet* | Nama file salah. Harus persis `Code`, `Core`, `Index`. |
| *Sheet "…" tidak ditemukan* | Jalankan fungsi `setup` dari editor. |
| Lupa password admin | Di editor jalankan fungsi **`resetAdminPassword`** (hanya bisa oleh pemilik script). Password kembali `admin123`. |
| Perubahan kode tidak tampil | Buat *New version* pada deployment (lihat di atas). |
| Muncul *Authorization required* | Jalankan `setup` lagi dan setujui izin. |
| Tombol cetak tidak memunculkan dialog | Buka URL `/exec` langsung di tab sendiri (bukan di dalam frame/pratinjau), izinkan pop-up bila diminta. |

## Perbedaan dengan versi PHP/MySQL sebelumnya
Versi ini menggantikan aplikasi PHP; folder PHP lama tidak diubah dan tidak dipakai. Alur kasir (scan barcode, F2 cari, F9 bayar, diskon, uang cepat, struk 58/80 mm, pemantauan stok) dipertahankan. Belum ada: pembatalan/retur transaksi dan pajak per barang.
