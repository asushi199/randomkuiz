# Peperiksaan Tatabahasa — Sistem Contoh (Bahasa Melayu)

Sistem **contoh / draf** untuk perbincangan: pelajar log masuk dengan **No. Kad Pengenalan** dan **nama**, sistem memilih **10 soalan rawak** daripada bank **100 soalan** (demo), menjawab di laman web, dan keputusan disimpan serta digred secara automatik melalui **Google Sheet** + **Google Apps Script**.

> **Nota:** Fail `100 Latihan Tatabahasa Bahasa Melayu.xlsx` ialah bank soalan contoh. Bank rasmi (cth. 350 soalan) boleh menggantikan sheet `Soalan` tanpa mengubah reka bentuk asas.

## Seni bina

```
Pelajar (pelayar) → GitHub Pages (HTML/JS)
                 → Google Apps Script (Web App)
                 → Google Sheet (Soalan, Percubaan, Keputusan)
```

- Laman web: paparan soalan & keputusan (Bahasa Melayu).
- Apps Script: cabut soalan, simpan percubaan, gred, tulis keputusan.
- **Jangan** simpan kunci Google atau `SPREADSHEET_ID` dalam repositori Git.

## Struktur repositori

| Laluan | Fungsi |
|--------|--------|
| `index.html`, `css/`, `js/` | Antara muka peperiksaan |
| `js/config.example.js` | URL Web App GAS (sunting sebelum deploy) |
| `data/questions.csv` | Bank soalan untuk import ke Sheet |
| `scripts/convert_xlsx_to_csv.py` | Tukar Excel → CSV |
| `apps-script/Code.gs` | Kod backend untuk tampal ke GAS |

## Langkah 1: Sediakan Google Sheet

1. Cipta Spreadsheet baharu.
2. Tambah tiga helaian dengan nama tepat: **`Soalan`**, **`Percubaan`**, **`Keputusan`**.
3. Pada helaian **`Soalan`**, baris pertama (header):

   `id` | `soalan` | `A` | `B` | `C` | `D` | `jawapan`

4. Import fail [`data/questions.csv`](data/questions.csv) ke helaian `Soalan` (Fail → Import).
5. Helaian **`Percubaan`** dan **`Keputusan`** boleh dibiarkan kosong — header akan dicipta automatik oleh skrip pada percubaan pertama, atau anda boleh letakkan header seperti dalam jadual di bawah.

**Percubaan:** `attempt_id`, `masa_mula`, `ic`, `nama`, `soalan_ids`, `status`  
**Keputusan:** `attempt_id`, `masa_hantar`, `ic`, `nama`, `betul`, `jumlah`, `skor`, `jawapan_json`

6. Salin **ID Spreadsheet** daripada URL (rentetan antara `/d/` dan `/edit`).
7. Kongsi sheet dengan akaun Google yang akan deploy skrip (sekurang-kurangnya Editor).

## Langkah 2: Google Apps Script

1. Dalam Spreadsheet: **Extensions** → **Apps Script**.
2. Padam kandungan lalai; tampal semua kod daripada [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** → **Script properties** → tambah:

   | Property | Nilai |
   |----------|--------|
   | `SPREADSHEET_ID` | ID spreadsheet anda |

4. **Deploy** → **New deployment** → jenis **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin **URL Web App** (berakhir dengan `/exec`).

## Langkah 3: Konfigurasi laman web

1. Buka [`js/config.example.js`](js/config.example.js).
2. Gantikan `YOUR_DEPLOYMENT_ID` dengan URL penuh Web App anda, contoh:

   ```javascript
   window.EXAM_CONFIG = {
     API_URL: "https://script.google.com/macros/s/AKfycb.../exec",
   };
   ```

3. (Pilihan tempatan) Salin ke `js/config.js` dan ubah `index.html` untuk memuatkan `config.js` — fail ini diabaikan oleh Git.

## Langkah 4: GitHub Pages

1. Push repositori ke GitHub.
2. **Settings** → **Pages** → Source: branch `main`, folder **/ (root)**.
3. Buka URL Pages (`https://<pengguna>.github.io/<repo>/`).

## Langkah 5: Ujian aliran

1. Buka laman peperiksaan.
2. Masukkan IC ujian (contoh: `900101015432`) dan nama.
3. Klik **Mula Peperiksaan** — 10 soalan dipaparkan.
4. Jawab semua soalan → **Hantar Jawapan**.
5. Semak **Keputusan Peperiksaan** dan baris baharu dalam sheet `Keputusan`.

**Peraturan sample:**

- Satu IC: satu peperiksaan (selepas hantar, tidak boleh mula semula; hanya lihat keputusan).
- Jika pelayar ditutup semasa `status = sedang`, log masuk semula dengan IC sama akan **sambung** set soalan yang sama.

## Kemas kini bank soalan

```bash
pip install openpyxl
python scripts/convert_xlsx_to_csv.py
```

Import semula `data/questions.csv` ke helaian `Soalan`. Laras `JUMLAH_SOALAN` dalam `Code.gs` jika bilangan soalan peperiksaan berubah.

## Privasi & had

- No. Kad Pengenalan disimpan dalam Google Sheet — hadkan akses sheet, jangan kongsi pautan awam.
- Pelajar perlu akses ke `script.google.com` (sambungan ke Google).
- Tiada pemeriksaan kamera, had masa, atau kocokan pilihan jawapan dalam sample ini.

## Rancangan seterusnya (cadangan)

- Ganti IC dengan nombor pelajar atau kod peperiksaan.
- Papan skor guru (helaian keempat atau paparan baca sahaja).
- Bank rasmi 350 soalan; laraskan `JUMLAH_SOALAN` dalam `Code.gs` (contoh 50 untuk peperiksaan penuh).

## Lesen data contoh

Fail Excel/CSV dalam repo ialah bahan latihan contoh untuk demonstrasi teknikal.
