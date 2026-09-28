// core-loader.js
//
// Core.gs adalah file Apps Script (bukan modul ES): berisi deklarasi
// `var`/`function` di level atas tanpa `export`, karena Apps Script
// menggabungkan semua file .gs jadi satu scope global sendiri. Deno
// (dan browser) memakai modul ES yang strict, jadi tidak bisa langsung
// `import` Core.gs apa adanya.
//
// Daripada menambahkan baris "export {...}" di Core.gs (yang berarti
// mengubah file itu), loader ini membaca Core.gs sebagai teks lalu
// menjalankannya di dalam sebuah `Function` — persis meniru bagaimana
// Apps Script sendiri "menempelkan" isi file itu ke scope global saat
// dijalankan. Hasilnya: Core.gs tetap 100% sama dengan yang dipakai di
// Google Apps Script, tinggal disalin ulang setiap kali diperbarui di
// sana, tanpa perlu diedit sama sekali untuk jalan di sini.
export async function loadCore(dir) {
  const src = await Deno.readTextFile(new URL('./Core.gs', dir));
  const factory = new Function(
    src + '\n;return { createBackend_: createBackend_, SCHEMA: SCHEMA, SETTING_DEFAULTS: SETTING_DEFAULTS };'
  );
  return factory();
}
