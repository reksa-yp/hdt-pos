// core-loader.js
//
// Core.gs adalah file Apps Script (bukan modul ES): berisi deklarasi
// `var`/`function` di level atas tanpa `export`, karena Apps Script
// menggabungkan semua file .gs jadi satu scope global sendiri. Deno
// (dan browser) memakai modul ES yang strict, jadi tidak bisa langsung
// `import` Core.gs apa adanya.
//
// Daripada menambahkan baris "export {...}" di Core.gs (yang berarti
// mengubah file itu), loader ini mengambil isi Core.gs (lewat
// core-src.js — lihat komentar di sana kenapa BUKAN dibaca langsung
// dari disk dengan Deno.readTextFile) sebagai teks, lalu menjalankannya
// di dalam sebuah `Function` — persis meniru bagaimana Apps Script
// sendiri "menempelkan" isi file itu ke scope global saat dijalankan.
// Hasilnya: Core.gs tetap 100% sama dengan yang dipakai di Google Apps
// Script, tinggal disalin ulang setiap kali diperbarui di sana, tanpa
// perlu diedit sama sekali untuk jalan di sini.
import { CORE_SRC_B64 } from './core-src.js';

function decodeB64Utf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
  return new TextDecoder('utf-8').decode(bytes);
}

export async function loadCore() {
  const src = decodeB64Utf8(CORE_SRC_B64);
  const factory = new Function(
    src + '\n;return { createBackend_: createBackend_, SCHEMA: SCHEMA, SETTING_DEFAULTS: SETTING_DEFAULTS };'
  );
  return factory();
}
