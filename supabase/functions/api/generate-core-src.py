#!/usr/bin/env python3
"""
Jalankan skrip ini setiap kali Core.gs diperbarui (disalin ulang dari
Google Apps Script), SEBELUM menjalankan `supabase functions deploy`.

Ini membaca Core.gs di folder yang sama, lalu menulis ulang core-src.js
(Core.gs disematkan sebagai teks base64 di dalam modul JS) — lihat
komentar di core-src.js untuk alasan kenapa ini diperlukan.

Cara pakai:
    python3 generate-core-src.py
"""
import base64
import pathlib

HERE = pathlib.Path(__file__).parent
core_gs = HERE / "Core.gs"
core_src_js = HERE / "core-src.js"

data = core_gs.read_bytes()
b64 = base64.b64encode(data).decode("ascii")
chunks = [b64[i:i + 200] for i in range(0, len(b64), 200)]

lines = [
    "// core-src.js",
    "//",
    "// Core.gs disematkan di sini sebagai teks base64 (bukan dibaca lewat",
    "// Deno.readTextFile saat runtime). Ini WAJIB, bukan gaya penulisan saja:",
    "// saat `supabase functions deploy` membundel function ini, bundler hanya",
    "// menyertakan file yang benar-benar di-`import` (mengikuti import graph),",
    "// BUKAN file yang cuma dibaca lewat Deno.readTextFile('./Core.gs') di",
    "// dalam kode. Karena itu, versi sebelumnya gagal dengan error",
    '// "path not found: .../Core.gs" di server produksi walau jalan normal',
    "// saat `supabase functions serve` lokal (lokal masih baca dari disk asli).",
    "//",
    "// Kalau Core.gs diperbarui (disalin ulang dari Google Apps Script), file",
    "// ini HARUS digenerate ulang dengan menjalankan:",
    "//   python3 supabase/functions/api/generate-core-src.py",
    "// sebelum `supabase functions deploy` dijalankan lagi.",
    "",
    "export const CORE_SRC_B64 =",
]
for i, c in enumerate(chunks):
    sep = " +" if i < len(chunks) - 1 else ";"
    lines.append('  "%s"%s' % (c, sep))

core_src_js.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"OK: {core_src_js.name} ditulis ulang ({len(data)} bytes Core.gs -> {len(b64)} karakter base64)")
