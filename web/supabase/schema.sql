-- ============================================================
-- Kuiz Ilmuan Cilik — Skema pangkalan data (Supabase / Postgres)
-- Jalankan dalam Supabase SQL Editor sekali sahaja.
-- ============================================================

-- --- Bank soalan Saringan 1 & 2 (350 soalan) ---
create table if not exists soalan (
  id       text primary key,
  topik    text not null,               -- AKIDAH/ALQURAN/JAWI/SIRAH/HADIS/IBADAH/ADAB
  aras     text not null,               -- 'sederhana' | 'tinggi'
  soalan   text not null,
  a text, b text, c text, d text,
  jawapan  text not null                -- 'A'..'D'
);

-- --- Bank soalan Saringan 3 Pusingan 1 (4 set x 10 objektif) ---
create table if not exists soalan_s3p1 (
  set_no   int  not null,               -- 1..4
  no       int  not null,               -- nombor global 1..40
  aras     text not null,               -- 'rendah'|'sederhana'|'tinggi'
  soalan   text not null,
  a text, b text, c text, d text,
  jawapan  text not null,
  primary key (set_no, no)
);

-- --- Bank soalan rebutan S3 Pusingan 2 (12 soalan objektif, pilih 8) ---
create table if not exists soalan_rebutan (
  no       int primary key,             -- 1..12
  topik    text,
  aras     text,
  soalan   text not null,
  a text, b text, c text, d text,
  jawapan  text not null                -- 'A'..'D'
);

-- --- Senarai daerah (12 pasukan) ---
create table if not exists daerah (
  kod   text primary key,
  nama  text not null,
  urutan int default 0
);

-- --- Senarai peserta (didaftar oleh pentadbir; juga senarai putih log masuk) ---
create table if not exists peserta (
  id      uuid primary key default gen_random_uuid(),
  daerah  text not null,
  ic      text not null,
  nama    text not null,
  sekolah text,
  masa    timestamptz not null default now()
);
create unique index if not exists peserta_ic_uniq on peserta (ic);

-- --- Tetapan sistem (key/value) ---
create table if not exists tetapan (
  kunci text primary key,
  nilai text
);
insert into tetapan (kunci, nilai) values ('peringkat_aktif', 'TUTUP')
  on conflict (kunci) do nothing;

-- --- Kelayakan: pasukan mana layak masuk peringkat berikut ---
create table if not exists kelayakan (
  peringkat text not null,              -- 'S2' | 'S3P1'
  daerah    text not null,
  primary key (peringkat, daerah)
);

-- --- Percubaan / keputusan (S1, S2, S3P1) ---
create table if not exists percubaan (
  id           uuid primary key default gen_random_uuid(),
  peringkat    text not null,           -- 'S1'|'S2'|'S3P1'
  ic           text not null,
  nama         text not null,
  daerah       text not null,
  set_no       int,                     -- untuk S3P1
  soalan_ids   text[] not null,
  topik_lapan  text,
  status       text not null default 'sedang',  -- 'sedang'|'selesai'
  masa_mula    timestamptz not null default now(),
  masa_hantar  timestamptz,
  betul        int,
  jumlah       int,
  skor         int,                     -- peratus 0..100
  mata         int,                     -- markah mentah (S3P1: 2 mata/soalan)
  jawapan      jsonb,
  butiran      jsonb
);

-- Satu percubaan sahaja per IC per peringkat (halang hantar berganda).
create unique index if not exists percubaan_ic_peringkat_uniq
  on percubaan (ic, peringkat);
-- S3P1 "satu kertas sepasukan": satu percubaan per daerah untuk S3P1.
create unique index if not exists percubaan_daerah_s3p1_uniq
  on percubaan (daerah) where peringkat = 'S3P1';

-- --- Log rebutan (S3 Pusingan 2) ---
create table if not exists rebutan_log (
  id         uuid primary key default gen_random_uuid(),
  no_soalan  int,
  daerah     text not null,
  betul      boolean,
  mata       int not null default 0,
  catatan    text,
  masa       timestamptz not null default now()
);

-- --- Markah manual (S3 Pusingan 3 tulisan: 3 soalan, dijumlah) ---
create table if not exists markah_manual (
  peringkat text not null,              -- 'S3P3'
  daerah    text not null,
  mata      int  not null default 0,    -- jumlah = mata1 + mata2 + mata3
  mata1     int  not null default 0,    -- Soalan 1
  mata2     int  not null default 0,    -- Soalan 2
  mata3     int  not null default 0,    -- Soalan 3
  catatan   text,
  masa      timestamptz not null default now(),
  primary key (peringkat, daerah)
);
