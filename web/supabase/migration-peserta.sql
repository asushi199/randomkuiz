-- ============================================================
-- Migrasi: jadual `peserta` (senarai peserta + senarai putih log masuk)
-- Jalankan sekali dalam Supabase SQL Editor.
-- Selamat dijalankan berulang (IF NOT EXISTS).
-- ============================================================
create table if not exists peserta (
  id      uuid primary key default gen_random_uuid(),
  daerah  text not null,
  ic      text not null,
  nama    text not null,
  sekolah text,
  masa    timestamptz not null default now()
);

-- Satu IC hanya boleh didaftar sekali (halang pendua).
create unique index if not exists peserta_ic_uniq on peserta (ic);
