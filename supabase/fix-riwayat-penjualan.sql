-- =====================================================================
-- PERBAIKAN: penjualan tidak masuk ke database / Riwayat kosong
-- Jalankan SEKALI di: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Penyebab: transaksi pelanggan umum disimpan dengan customer_id = 0,
-- padahal kolom itu FOREIGN KEY ke customers(id) dan id 0 tidak ada,
-- sehingga Postgres menolak setiap penjualan tanpa pelanggan terdaftar.
-- Edge Function versi baru mengirim NULL untuk nilai 0 tersebut.
-- Skrip ini juga membuat hapus produk/pelanggan/user tidak lagi gagal
-- karena masih dipakai di riwayat (referensinya menjadi NULL).
-- Aman dijalankan berulang kali; tidak menghapus data apa pun.
-- =====================================================================
begin;

alter table transactions drop constraint if exists transactions_customer_id_fkey;
alter table transactions add  constraint transactions_customer_id_fkey foreign key (customer_id) references customers(id) on delete set null;
alter table transactions drop constraint if exists transactions_user_id_fkey;
alter table transactions add  constraint transactions_user_id_fkey     foreign key (user_id)     references users(id)     on delete set null;

alter table tx_items drop constraint if exists tx_items_user_id_fkey;
alter table tx_items add  constraint tx_items_user_id_fkey    foreign key (user_id)    references users(id)    on delete set null;
alter table tx_items drop constraint if exists tx_items_product_id_fkey;
alter table tx_items add  constraint tx_items_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table stock_log drop constraint if exists stock_log_product_id_fkey;
alter table stock_log add  constraint stock_log_product_id_fkey foreign key (product_id) references products(id) on delete set null;

alter table evaluations drop constraint if exists evaluations_user_id_fkey;
alter table evaluations add  constraint evaluations_user_id_fkey foreign key (user_id) references users(id) on delete set null;

alter table services drop constraint if exists services_received_by_fkey;
alter table services add  constraint services_received_by_fkey foreign key (received_by) references users(id) on delete set null;

-- kunci yang tertinggal dari request yang gagal di tengah jalan
update _locks set locked_at = null where key = 'global';

commit;
