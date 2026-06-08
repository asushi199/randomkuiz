# Peperiksaan Agama — Pertandingan Peringkat Negeri

Sistem peperiksaan dalam talian: pelajar log masuk dengan **daerah**, **No. Kad Pengenalan** dan **nama**, menjawab **50 soalan** yang dicabut mengikut peraturan 7 topik, dan hanya melihat mesej **terima kasih** selepas hantar. Pentadbir/juri menyemak jawapan melalui halaman berasingan dengan **PIN daerah** atau **PIN negeri**.

## Bank soalan

- **7 topik**, setiap satu **50 soalan** (1–25 aras sederhana, 26–50 aras tinggi) = **350 soalan**
- Sumber: folder [`Bank Soalan/`](Bank%20Soalan/) (fail DOCX)
- Jana semula CSV:

```bash
pip install -r requirements.txt
python scripts/convert_docx_bank.py
```

Import [`data/questions.csv`](data/questions.csv) ke helaian Google Sheet **`Soalan`** (ganti kandungan lama).

| Kod topik | Fail |
|-----------|------|
| AKIDAH | SOALAN TOPIK AKIDAH.docx |
| ALQURAN | SOALAN TOPIK AL-QURAN.docx |
| JAWI | SOALAN TOPIK JAWI.docx |
| SIRAH | SOALAN TOPIK SIRAH.docx |
| HADIS | 50 SOALAN HADIS.docx |
| IBADAH | 50 SOALAN IBADAH.docx |
| ADAB | 50 SOALAN ADAB.docx |

## Peraturan cabutan 50 soalan

1. Satu topik dipilih secara rawak untuk **8 soalan**; enam topik lain **7 soalan** setiap satu.
2. Topik 7 soalan: **4 sederhana** + **3 tinggi**
3. Topik 8 soalan: **4 sederhana** + **4 tinggi**
4. Urutan 50 soalan dikocok untuk paparan

## Seni bina

```
Pelajar → GitHub Pages (index.html)
       → Google Apps Script (Web App)
       → Google Sheet (Soalan, Daerah, Pentadbir, Percubaan, Keputusan)

Pentadbir → GitHub Pages (pentadbir.html) + PIN → adminReview / adminReset / adminSetPin
```

## Google Sheet

### Soalan

`id` | `topik` | `aras` | `soalan` | `A` | `B` | `C` | `D` | `jawapan`

### Daerah (senarai 12 daerah — dropdown pelajar)

`kod` | `nama`

Contoh:

| kod | nama |
|-----|------|
| MANJUNG | Daerah Manjung |
| KERIAN | Daerah Kerian |
| PERAK_TENGAH | Daerah Perak Tengah |
| … | *(12 daerah — lihat `data/daerah-perak.csv`)* |
| KINTA_UTARA | Daerah Kinta Utara |
| KINTA_SELATAN | Daerah Kinta Selatan |

> `kod` huruf besar, tanpa ruang (gunakan `_` jika perlu). Import [`data/daerah-perak.csv`](data/daerah-perak.csv) ke helaian `Daerah`; kemas kini [`js/daerah-perak.js`](js/daerah-perak.js) jika senarai berubah.

### Pentadbir (PIN — jangan kongsi helaian ini)

`kod_daerah` | `nama_daerah` | `pin` | `peranan`

| kod_daerah | nama_daerah | pin | peranan |
|------------|-------------|-----|---------|
| MANJUNG | Daerah Manjung | *(8 digit rawak)* | daerah |
| … | … | … | daerah |
| NEGERI | Peringkat Negeri | *(8 digit rawak)* | negeri |

- **PIN daerah** (`peranan` = `daerah`): ranking dan semakan **hanya peserta daerah itu**.
- **PIN negeri** (`peranan` = `negeri`, `kod_daerah` = `NEGERI`): ranking **36 peserta** + lajur daerah; reset data; tukar PIN daerah.
- Jana PIN rawak 8 digit (elak 123456, 111111, urutan nombor). Jangan commit PIN dalam Git.

### Percubaan

`attempt_id` | `masa_mula` | `ic` | `nama` | `daerah` | `soalan_ids` | `status` | `topik_lapan`

### Keputusan

`attempt_id` | `masa_hantar` | `ic` | `nama` | `daerah` | `betul` | `jumlah` | `skor` | `jawapan_json` | `butiran_json`

> **Migrasi helaian lama:** sisipkan lajur `daerah` selepas `nama` dalam `Percubaan` dan `Keputusan`, atau buat helaian baharu. Tambah helaian `Daerah` dan `Pentadbir` mengikut jadual di atas.

## Google Apps Script

1. Tampal [`apps-script/Code.gs`](apps-script/Code.gs)
2. **Script properties:**

| Property | Nilai |
|----------|--------|
| `SPREADSHEET_ID` | ID spreadsheet |
| `ADMIN_PIN` | *(pilihan)* fallback jika helaian `Pentadbir` kosong — guna mod negeri sahaja |

3. **Deploy** → Web app → Execute as: **Me** → Who has access: **Anyone**
4. Salin URL `/exec` ke [`js/config.js`](js/config.example.js) (fail tempatan, jangan commit)

## GitHub Pages

- Laman pelajar: `https://<pengguna>.github.io/<repo>/`
- Pautan pra-pilih daerah: `…/?daerah=MANJUNG` (masih laman sama)
- Laman pentadbir: `https://<pengguna>.github.io/<repo>/pentadbir.html`  
  (jangan pautkan dari laman pelajar)

## Aliran pelajar

1. Pilih **daerah** + IC + nama → **Mula Kuiz**
2. Jawab 50 soalan → **Hantar Jawapan**
3. Paparan **Terima kasih** sahaja (tiada markah)

Satu IC boleh digunakan dalam daerah berbeza (contoh ujian), tetapi **hanya sekali setiap daerah**.

## Aliran pentadbir

### PIN daerah

1. Buka `pentadbir.html`, masukkan **PIN daerah**
2. Kosongkan No. KP → **kedudukan daerah** (peserta daerah itu sahaja)
3. PIN + No. KP → semak jawapan individu (hanya IC dalam daerah itu)

### PIN negeri (juri / jawatankuasa)

1. Masukkan **PIN negeri** → kedudukan **36 peserta** dengan lajur daerah
2. **Reset data peperiksaan** — kosongkan `Percubaan` + `Keputusan` sebelum perlawanan rasmi (selepas ujian pra-perlawanan)
3. **Tukar PIN daerah** — pilih daerah, masukkan PIN baharu (6–12 digit)

4. **Cetak / PDF**, **Muat turun PNG** atau **JPG** pada laporan
5. Susunan ranking: markah tertinggi dahulu; **markah sama** → tempoh jawapan lebih pendek menang
6. Tempoh kuiz: **1 jam** dari masa mula

## Ujian pra-perlawanan → perlawanan rasmi (12 daerah)

Checklist jawatankuasa negeri:

1. [ ] Isi helaian `Daerah` (12 baris) dan `Pentadbir` (12 PIN daerah + 1 PIN negeri)
2. [ ] Import bank soalan ke `Soalan`
3. [ ] Deploy GAS + kemas kini `config.js` + GitHub Pages
4. [ ] Edar kepada setiap daerah: pautan pelajar (+ `?daerah=KOD` jika perlu) + pautan pentadbir + **PIN daerah mereka sahaja**
5. [ ] Setiap daerah uji 1–2 IC; sahkan daerah lain **tidak** nampak dalam ranking
6. [ ] Sebelum hari perlawanan: log masuk dengan **PIN negeri** → **Reset data peperiksaan**
7. [ ] *(Pilihan)* Tukar PIN daerah jika PIN ujian didedahkan
8. [ ] Hari perlawanan: 36 peserta, negeri guna PIN negeri; daerah guna PIN masing-masing

## API (ringkas)

| action | Pengguna | Nota |
|--------|----------|------|
| `getDaerahList` | Pelajar / pentadbir | `{ kod, nama }[]` — tiada PIN |
| `startExam` | Pelajar | `ic`, `nama`, `daerah` — soalan tanpa jawapan |
| `submitExam` | Pelajar | Simpan keputusan; respons terima kasih sahaja |
| `getResult` | Pelajar | `ic`, `daerah` — `sudah_hantar` + mesej |
| `adminReview` | Pentadbir | PIN daerah → ranking daerah; PIN negeri → ranking negeri |
| `adminReset` | PIN negeri | Kosongkan Percubaan + Keputusan |
| `adminSetPin` | PIN negeri | `kod_daerah`, `pin_baru` |

## Pertandingan ~36 peserta serentak

Skala disasarkan **12 daerah × 3 peserta**. Platform (**GAS + Sheet**) biasanya mencukupi jika:

- Peserta dibenarkan log masuk **2–3 minit lebih awal**
- Masa hantar berbeza (tiada konflik tulis antara IC berbeza)
- Ujian pra-perlawanan: **5–10 IC ujian** serentak

Frontend pelajar cuba sehingga **6 kali**; pentadbir **2 kali** pada ralat sambungan.

## Privasi

- IC disimpan dalam Sheet — **hadkan akses spreadsheet** kepada IT jawatankuasa negeri sahaja
- Jangan kongsi PIN negeri kepada pentadbir daerah
- Jangan commit `js/config.js` atau PIN dalam Git

## Struktur repositori

| Laluan | Fungsi |
|--------|--------|
| `index.html`, `js/app.js` | Peperiksaan pelajar |
| `pentadbir.html`, `js/pentadbir.js` | Semakan juri |
| `apps-script/Code.gs` | Backend |
| `data/questions.csv` | Bank untuk import Sheet |
| `scripts/convert_docx_bank.py` | DOCX → CSV |
