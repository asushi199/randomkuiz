-- Migrasi: S3P3 kini 3 soalan (dijumlah). Jalankan sekali dalam Supabase SQL Editor.
alter table markah_manual
  add column if not exists mata1 int not null default 0,
  add column if not exists mata2 int not null default 0,
  add column if not exists mata3 int not null default 0;
