# Kuiz Ilmuan Cilik — FiESH (Sistem Pertandingan Berbilang Peringkat)

Sistem kuiz dalam talian untuk pertandingan **peringkat negeri** (12 daerah). Pelajar log
masuk dengan **daerah + No. KP + nama**; pentadbir mengawal keseluruhan pertandingan melalui
**satu PIN** dari panel pentadbir. Backend menggunakan **Google Apps Script + Google Sheet**;
frontend statik di **GitHub Pages**.

## Format pertandingan

```
Saringan 1 (50 soalan, peraturan cabutan)                 12 pasukan → 6 pasukan
Saringan 2 (50 soalan, individu TIADA soalan berulang)     6 pasukan → 4 pasukan
Saringan 3 — penentu kedudukan akhir (markah terkumpul):
   Pusingan 1  4 set objektif (10 soalan) diagih rawak; satu kertas sepasukan;
               setiap soalan 20 saat, 2 markah; kira markah + masa
   Pusingan 2  8 soalan rebutan (dipilih 8 drpd 12) — dipapar di skrin besar,
               juri sahkan betul, jawapan didedah, markah direkod
   Pusingan 3  soalan tulisan — markah dimasukkan manual oleh pentadbir
   → Kedudukan akhir 1–4 = jumlah (P1 + P2 + P3)
```

- **Pasukan = daerah** (3 ahli). Markah pasukan (S1/S2) = **jumlah 3 markah tertinggi**; seri → masa lebih pendek menang.
- **No. KP = kunci pengenalan** (nama ditaip sendiri). Pelajar mesti pilih **daerah** semasa log masuk.

## Peraturan cabutan (S1/S2)

1. Satu topik rawak dapat **8 soalan**; enam topik lain **7 soalan**.
2. Topik 7 soalan: **4 sederhana + 3 tinggi**; topik 8 soalan: **4 sederhana + 4 tinggi**.
3. 50 soalan dikocok. **S2 mengecualikan** soalan yang pernah diterima IC itu di S1.

## Seni bina

```
Pelajar   → GitHub Pages (index.html)      ┐
Pentadbir → GitHub Pages (pentadbir.html)  ├→ Google Apps Script (Web App /exec)
Skrin     → GitHub Pages (skrin.html)      ┘        → Google Sheet (pangkalan data)
```

## Pemasangan (sekali sahaja)

### 1. Google Sheet
Buat satu Google Sheet, import CSV ke helaian bernama **sama**:

| Helaian | Import |
|---------|--------|
| `Soalan` | `data/questions.csv` |
| `SoalanS3P1` | `data/soalan-s3p1.csv` |
| `SoalanRebutan` | `data/soalan-rebutan.csv` |
| `Daerah` | `data/daerah-perak.csv` |

Helaian lain (`Tetapan`, `Kelayakan`, `Percubaan`, `Keputusan`, `Rebutan`, `MarkahManual`)
dibuat automatik oleh skrip pada penggunaan pertama.

### 2. Apps Script
1. Extensions → Apps Script (atau projek berasingan). Tampal [`apps-script/Code.gs`](apps-script/Code.gs).
2. Project Settings → **Script properties**:
   - `SPREADSHEET_ID` = ID Sheet (bahagian antara `/d/` dan `/edit` pada URL)
   - `ADMIN_PIN` = PIN pentadbir (**kuat, bukan nama daerah/123456**)
3. Deploy → **New deployment** → Web app → Execute as **Me**, Who has access **Anyone** → salin URL `/exec`.

### 3. Frontend
- Salin URL `/exec` ke [`js/config.js`](js/config.example.js) (`API_URL`).
- GitHub Pages: Settings → Pages → deploy dari `main` (root). Laman:
  - Pelajar: `https://<user>.github.io/<repo>/`
  - Pentadbir: `.../pentadbir.html`  · Skrin rebutan: `.../skrin.html`

### 4. Regenerasi CSV / SQL (jika soalan berubah)
```bash
python scripts/convert_docx_bank.py        # bank S1/S2 (DOCX → questions.csv)
python scripts/convert_saringan3.py        # S3P1 + rebutan (DOCX → CSV)
```

## Panel pentadbir (satu PIN)

- **Peringkat aktif** — buka/tukar peringkat yang pelajar boleh masuk (S1 / S2 / S3P1 / S3P2 / S3P3 / TUTUP).
- **Kedudukan** — pilih peringkat → jadual **pasukan** + **individu**. Pada S1/S2, tanda pasukan layak → **Kunci kelayakan** ke peringkat seterusnya (6 lalu 4).
- **Semakan individu** — masukkan No. KP + peringkat → jawapan penuh peserta (untuk aduan).
- **Skrin rebutan (S3P2)** — buka `skrin.html`: papar soalan+pilihan, "Papar Jawapan", butang markah setiap pasukan.
- **Markah manual (S3P3)** — masukkan markah tulisan setiap pasukan.
- **Kedudukan akhir** — jana kedudukan terkumpul (P1+P2+P3).
- **Reset** — kosongkan rekod (sebelum perlawanan rasmi). Bank soalan & daerah tidak diubah.

## Senarai semak hari pertandingan

1. [ ] `ADMIN_PIN` ditukar kepada PIN kuat rasmi.
2. [ ] **Reset semua rekod** (buang data ujian).
3. [ ] Peringkat = **S1**. Pelajar log masuk (pilih daerah), jawab 50 soalan.
4. [ ] Selepas S1: Kedudukan → kunci **6 pasukan** ke S2. Tukar peringkat ke **S2**.
5. [ ] Selepas S2: kunci **4 pasukan** ke S3P1. Tukar peringkat ke **S3P1**.
6. [ ] S3P1 selesai → peringkat **S3P2**, buka skrin rebutan, rekod markah.
7. [ ] S3P3: masukkan markah tulisan → **Jana Kedudukan Akhir** → juara 1–4.

> Nasihat operasi: minta peserta log masuk dalam tempoh 1–2 minit (bukan serentak sesaat)
> untuk kelancaran; frontend cuba semula automatik jika sambungan sekejap sibuk.

## Struktur repositori

| Laluan | Fungsi |
|--------|--------|
| `index.html`, `js/app.js` | Pelajar (S1/S2 + S3P1 pantas 20s) |
| `pentadbir.html`, `js/pentadbir.js` | Panel pentadbir |
| `skrin.html` | Skrin rebutan S3P2 (paparan besar) |
| `apps-script/Code.gs` | Backend GAS |
| `data/*.csv` | Bank soalan & daerah (import ke Sheet) |
| `scripts/*.py` | Penukar DOCX/XLSX → CSV, penjana SQL, ujian cabutan |

## Privasi

- No. KP disimpan dalam Sheet — **hadkan akses spreadsheet** kepada jawatankuasa sahaja.
- `ADMIN_PIN` rahsia; jangan kongsi. `js/config.js` mengandungi URL Web App awam (bukan rahsia).
