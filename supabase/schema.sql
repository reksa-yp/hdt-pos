-- =====================================================================
-- HDT POS — Skema database PostgreSQL untuk Supabase
-- Setara 1:1 dengan struktur SCHEMA di Core.gs (Google Sheets) saat ini.
-- Jalankan file ini di: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- CATATAN PENTING soal kolom "id": TIDAK memakai auto-increment
-- (generated identity) Postgres. Persis seperti perilaku Google Sheets
-- sekarang (Code.gs: maxId(list)+1), id tabel dihitung dan diisi sendiri
-- oleh aplikasi (lihat supabase/functions/api/platform.js) supaya baris
-- yang saling berelasi dalam satu request (misalnya Transaction + baris
-- TxItems-nya) bisa saling mereferensikan id sebelum benar-benar
-- tersimpan ke database.
-- =====================================================================

create table if not exists users (
  id          bigint primary key,
  username    text not null unique,
  salt        text not null,
  pass_hash   text not null,
  full_name   text not null,
  role        text not null check (role in ('admin','kasir')),
  active      boolean not null default true,
  last_login  text,
  created_at  text
);

create table if not exists categories (
  id   bigint primary key,
  name text not null unique
);

create table if not exists products (
  id           bigint primary key,
  type         text not null check (type in ('barang','jasa')),
  category     text,
  sku          text,
  barcode      text,
  name         text not null,
  unit         text not null default 'pcs',
  cost_price   numeric(14,2) not null default 0,
  price        numeric(14,2) not null default 0,
  stock        numeric(14,2) not null default 0,
  min_stock    numeric(14,2) not null default 0,
  track_stock  boolean not null default true,
  created_at   text
);
create index if not exists idx_products_barcode on products(barcode);
create index if not exists idx_products_sku     on products(sku);
create index if not exists idx_products_name    on products using gin (to_tsvector('simple', name));

create table if not exists customers (
  id         bigint primary key,
  name       text not null,
  phone      text,
  email      text,
  address    text,
  created_at text
);

create table if not exists transactions (
  id               bigint primary key,
  invoice_no       text not null unique,
  date             text,
  user_id          bigint references users(id) on delete set null,
  user_name        text,
  customer_id      bigint references customers(id) on delete set null,
  customer_name    text,
  customer_addr    text,
  subtotal         numeric(14,2) not null default 0,
  discount_type    text,
  discount_value   numeric(14,2) default 0,
  discount_amount  numeric(14,2) default 0,
  tax_rate         numeric(6,2) default 0,
  tax_amount       numeric(14,2) default 0,
  grand_total      numeric(14,2) not null default 0,
  method           text check (method in ('cash','transfer','debit','credit','qris')),
  amount_paid      numeric(14,2) default 0,
  change           numeric(14,2) default 0,
  status           text default 'completed',
  note             text
);
create index if not exists idx_tx_date     on transactions(date);
create index if not exists idx_tx_customer on transactions(customer_id);
create index if not exists idx_tx_user     on transactions(user_id);

create table if not exists tx_items (
  id          bigint primary key,
  tx_id       bigint references transactions(id) on delete cascade,
  invoice_no  text,
  date        text,
  user_id     bigint references users(id) on delete set null,
  product_id  bigint references products(id) on delete set null,
  name        text,
  type        text,
  qty         numeric(14,2) not null default 0,
  price       numeric(14,2) not null default 0,
  cost        numeric(14,2) default 0,
  subtotal    numeric(14,2) not null default 0
);
create index if not exists idx_txitems_tx      on tx_items(tx_id);
create index if not exists idx_txitems_product on tx_items(product_id);

-- "from"/"to" adalah kata kunci SQL, jadi disimpan sebagai period_from/period_to.
-- Pemetaan nama field dilakukan otomatis di platform.js, Core.gs tidak berubah.
create table if not exists evaluations (
  id          bigint primary key,
  user_id     bigint references users(id) on delete set null,
  period_from text,
  period_to   text,
  rating      numeric(3,1),
  bonus       numeric(14,2) default 0,
  note        text,
  updated_at  text,
  updated_by  text
);
create index if not exists idx_eval_user on evaluations(user_id);

create table if not exists stock_log (
  id         bigint primary key,
  date       text,
  product_id bigint references products(id) on delete set null,
  name       text,
  user_name  text,
  type       text,
  change     numeric(14,2),
  before     numeric(14,2),
  after      numeric(14,2),
  note       text
);
create index if not exists idx_stocklog_product on stock_log(product_id);
create index if not exists idx_stocklog_date on stock_log(date);

create table if not exists settings (
  key   text primary key,
  value text
);

create table if not exists services (
  id                bigint primary key,
  service_no        text unique,
  date_in           text,
  date_out          text,
  customer_name     text,
  phone             text,
  item_name         text,
  item_color        text,
  completeness      text,
  problem           text,
  status            text default 'proses' check (status in ('proses','tersedia','diambil')),
  received_by       bigint references users(id) on delete set null,
  received_by_name  text,
  picked_up_at      text,
  note              text
);
create index if not exists idx_services_status on services(status);
create index if not exists idx_services_date on services(date_in);

-- Penawaran harga. "items" berisi daftar barang/jasa dalam bentuk teks JSON
-- (sama seperti kolom "items" di sheet Quotes pada Google Sheets).
create table if not exists quotes (
  id               bigint primary key,
  quote_no         text unique,
  date             text,
  valid_days       integer not null default 14,
  valid_until      text,
  customer_name    text,
  customer_phone   text,
  customer_addr    text,
  items            text not null default '[]',
  subtotal         numeric(14,2) not null default 0,
  discount_type    text,
  discount_value   numeric(14,2) default 0,
  discount_amount  numeric(14,2) default 0,
  tax_rate         numeric(6,2) default 0,
  tax_amount       numeric(14,2) default 0,
  grand_total      numeric(14,2) not null default 0,
  note             text,
  user_id          bigint,
  user_name        text,
  created_at       text,
  updated_at       text
);
create index if not exists idx_quotes_date on quotes(date);

-- Kunci sederhana untuk operasi tulis (checkout, dsb) supaya tidak tabrakan
-- saat dua request datang bersamaan — dipakai oleh P.lock() di platform.js,
-- setara LockService.getScriptLock() di Apps Script.
create table if not exists _locks (
  key       text primary key,
  locked_at timestamptz
);
insert into _locks (key, locked_at) values ('global', null) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Nilai bawaan pengaturan toko (sama seperti SETTING_DEFAULTS di Core.gs)
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('store_name', 'HDT POS'), ('store_address', ''), ('store_phone', ''), ('store_email', ''),
  ('tax_no', ''), ('bank_name', ''), ('bank_account', ''), ('bank_holder', ''),
  ('tax_rate', '0'), ('paper_width', '80'), ('receipt_footer', 'Terima kasih atas kunjungan Anda.'),
  ('show_logo_on_receipt', '1'), ('auto_print', '0'), ('inv_code', '200'), ('inv_year', ''), ('inv_next', '1')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Row Level Security: DIKUNCI TOTAL secara default.
-- Backend mengakses lewat "service_role" key (bypass RLS, HANYA dipakai
-- di server/Edge Function, tidak pernah dikirim ke browser). Jangan
-- aktifkan akses langsung dari browser dengan anon key sebelum policy
-- per-tabel dirancang sesuai peran admin/kasir.
-- ---------------------------------------------------------------------
alter table users        enable row level security;
alter table categories   enable row level security;
alter table products     enable row level security;
alter table customers    enable row level security;
alter table transactions enable row level security;
alter table tx_items     enable row level security;
alter table evaluations  enable row level security;
alter table stock_log    enable row level security;
alter table settings     enable row level security;
alter table services     enable row level security;
alter table quotes       enable row level security;
alter table _locks       enable row level security;
