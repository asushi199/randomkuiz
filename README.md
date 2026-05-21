# Peperiksaan Agama — Pertandingan Peringkat Negeri

Sistem peperiksaan dalam talian: pelajar log masuk dengan **No. Kad Pengenalan** dan **nama**, menjawab **50 soalan** yang dicabut mengikut peraturan 7 topik, dan hanya melihat mesej **terima kasih** selepas hantar. Pentadbir/juri menyemak jawapan melalui halaman berasingan dengan **PIN**.

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
       → Google Sheet (Soalan, Percubaan, Keputusan)

Pentadbir → GitHub Pages (pentadbir.html) + PIN → adminReview
```

## Google Sheet

### Soalan

`id` | `topik` | `aras` | `soalan` | `A` | `B` | `C` | `D` | `jawapan`

### Percubaan

`attempt_id` | `masa_mula` | `ic` | `nama` | `soalan_ids` | `status` | `topik_lapan`

### Keputusan

`attempt_id` | `masa_hantar` | `ic` | `nama` | `betul` | `jumlah` | `skor` | `jawapan_json` | `butiran_json`

> Jika helaian lama tiada lajur baharu, tambah lajur mengikut urutan di atas atau buat helaian baharu dan import semula.

## Google Apps Script

1. Tampal [`apps-script/Code.gs`](apps-script/Code.gs)
2. **Script properties:**

| Property | Nilai |
|----------|--------|
| `SPREADSHEET_ID` | ID spreadsheet |
| `ADMIN_PIN` | PIN untuk halaman pentadbir (contoh 6–8 digit) |

3. **Deploy** → Web app → Execute as: **Me** → Who has access: **Anyone**
4. Salin URL `/exec` ke [`js/config.example.js`](js/config.example.js)

## GitHub Pages

- Laman pelajar: `https://<pengguna>.github.io/<repo>/`
- Laman pentadbir: `https://<pengguna>.github.io/<repo>/pentadbir.html`  
  (jangan pautkan dari laman pelajar)

## Aliran pelajar

1. IC + nama → **Mula Peperiksaan**
2. Jawab 50 soalan → **Hantar Jawapan**
3. Paparan **Terima kasih** sahaja (tiada markah)

## Aliran pentadbir

1. Buka `pentadbir.html`
2. Masukkan **PIN** + **IC peserta**
3. Lihat markah dan senarai betul/salah setiap soalan

## API (ringkas)

| action | Pengguna | Nota |
|--------|----------|------|
| `startExam` | Pelajar | Pulangkan soalan tanpa jawapan |
| `submitExam` | Pelajar | Simpan keputusan; respons terima kasih sahaja |
| `getResult` | Pelajar | `sudah_hantar` + mesej terima kasih |
| `adminReview` | Pentadbir | `pin` + `ic` → markah + `butiran` |

## Pertandingan ~36 peserta serentak

Skala disasarkan **12 daerah × 3 peserta**. Platform semasa (**GAS + Sheet**) biasanya mencukupi jika:

- Peserta dibenarkan log masuk **2–3 minit lebih awal** (elak semua klik serentak)
- Masa hantar berbeza (tiada konflik tulis antara IC berbeza)
- Ujian pra-perlawanan: **5–10 IC ujian** serentak

Frontend sudah ada **retry automatik** (2 kali) pada ralat sambungan.

Jika ujian pra-perlawanan gagal kerap, pertimbangkan akaun **Google Workspace** (kuota lebih tinggi). Untuk 36 orang, **tidak perlu** tukar platform secara lalai.

## Privasi

- IC disimpan dalam Sheet — hadkan akses, jangan kongsi pautan spreadsheet
- Jangan commit PIN dalam Git; hanya dalam Script properties

## Struktur repositori

| Laluan | Fungsi |
|--------|--------|
| `index.html`, `js/app.js` | Peperiksaan pelajar |
| `pentadbir.html`, `js/pentadbir.js` | Semakan juri |
| `apps-script/Code.gs` | Backend |
| `data/questions.csv` | Bank untuk import Sheet |
| `scripts/convert_docx_bank.py` | DOCX → CSV |
