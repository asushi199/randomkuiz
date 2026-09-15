/**
 * Kuiz Ilmuan Cilik — Backend Google Apps Script (versi berbilang peringkat)
 *
 * Script properties:
 *   SPREADSHEET_ID  — ID spreadsheet
 *   ADMIN_PIN       — satu PIN pentadbir (peringkat negeri) sahaja
 *
 * Peringkat: S1, S2, S3P1 (pelajar) ; S3P2 rebutan & S3P3 tulisan (pentadbir).
 * Helaian: Soalan, SoalanS3P1, SoalanRebutan, Daerah, Tetapan, Kelayakan,
 *          Percubaan, Keputusan, Rebutan, MarkahManual.
 */

// ---------- Pemalar ----------
const JUMLAH_SOALAN = 50;
const TOPIK_LIST = ['AKIDAH', 'ALQURAN', 'JAWI', 'SIRAH', 'HADIS', 'IBADAH', 'ADAB'];
const TEMPOH_KUIZ_MS = 60 * 60 * 1000;        // S1/S2 = 1 jam
const S3P1_SET_COUNT = 4;
const S3P1_SOALAN = 10;
const S3P1_SAAT_SESOALAN = 20;                 // 20 saat/soalan (kiraan di pelayar)
const S3P1_MATA_SESOALAN = 2;                  // 2 mata/soalan
const REBUTAN_PILIH = 8;                        // pilih 8 drpd 12

const SHEET_SOALAN = 'Soalan';
const SHEET_S3P1 = 'SoalanS3P1';
const SHEET_REBUTAN = 'SoalanRebutan';
const SHEET_DAERAH = 'Daerah';
const SHEET_TETAPAN = 'Tetapan';
const SHEET_KELAYAKAN = 'Kelayakan';
const SHEET_PERCUBAAN = 'Percubaan';
const SHEET_KEPUTUSAN = 'Keputusan';
const SHEET_LOG_REBUTAN = 'Rebutan';
const SHEET_MARKAH = 'MarkahManual';

const STATUS_SEDANG = 'sedang';
const STATUS_SELESAI = 'selesai';

const PERINGKAT_PELAJAR = ['S1', 'S2', 'S3P1'];
const PERINGKAT_LABEL = {
  S1: 'Saringan 1',
  S2: 'Saringan 2',
  S3P1: 'Saringan 3 — Pusingan 1',
  S3P2: 'Saringan 3 — Pusingan 2 (Rebutan)',
  S3P3: 'Saringan 3 — Pusingan 3 (Tulisan)',
  TUTUP: 'Ditutup',
};
const MSJ_TERIMA_KASIH =
  'Terima kasih. Jawapan anda telah direkodkan. Keputusan akan diumumkan oleh pihak pengurusan.';

// ---------- Titik masuk ----------
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); }
      catch (err) { return jsonResponse({ ok: false, ralat: 'JSON tidak sah.' }); }
    }
    const action = (params.action || body.action || '').trim();
    const p = Object.assign({}, params, body);
    delete p.action;

    switch (action) {
      // Pelajar
      case 'getInit':      return jsonResponse(getInit());
      case 'startExam':    return jsonResponse(startExam(p.ic, p.nama, p.daerah));
      case 'submitExam':   return jsonResponse(submitExam(p.ic, p.attempt_id, p.jawapan));
      case 'getResult':    return jsonResponse(getResult(p.ic, p.daerah));
      // Pentadbir (perlu ADMIN_PIN)
      case 'adminState':   return jsonResponse(adminState(p.pin));
      case 'adminSetPeringkat': return jsonResponse(adminSetPeringkat(p.pin, p.peringkat));
      case 'adminRanking': return jsonResponse(adminRanking(p.pin, p.peringkat));
      case 'adminReview':  return jsonResponse(adminReview(p.pin, p.peringkat, p.ic));
      case 'adminLock':    return jsonResponse(adminLock(p.pin, p.peringkat, p.daerah_list));
      case 'adminRebutanSoalan': return jsonResponse(adminRebutanSoalan(p.pin, p.pilih_semula));
      case 'adminRebutanScore':  return jsonResponse(adminRebutanScore(p.pin, p.no_soalan, p.daerah, p.betul, p.mata));
      case 'adminSetManual': return jsonResponse(adminSetManual(p.pin, p.peringkat, p.daerah, p.mata, p.catatan));
      case 'adminFinal':   return jsonResponse(adminFinal(p.pin));
      case 'adminReset':   return jsonResponse(adminReset(p.pin, p.skop));
      default:             return jsonResponse({ ok: false, ralat: 'Tindakan tidak dikenali.' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, ralat: err.message || String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Asas spreadsheet ----------
function getSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID belum ditetapkan.');
  return id;
}
function getAdminPin_() {
  return (PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '').trim();
}
function getSs_() { return SpreadsheetApp.openById(getSpreadsheetId_()); }

function getSheet_(name) {
  const ss = getSs_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); initHeaders_(sh, name); }
  return sh;
}

function initHeaders_(sh, name) {
  if (sh.getLastRow() > 0) return;
  const H = {
    [SHEET_SOALAN]: ['id', 'topik', 'aras', 'soalan', 'A', 'B', 'C', 'D', 'jawapan'],
    [SHEET_S3P1]: ['set', 'no', 'aras', 'soalan', 'A', 'B', 'C', 'D', 'jawapan'],
    [SHEET_REBUTAN]: ['no', 'topik', 'aras', 'soalan', 'A', 'B', 'C', 'D', 'jawapan'],
    [SHEET_DAERAH]: ['kod', 'nama'],
    [SHEET_TETAPAN]: ['kunci', 'nilai'],
    [SHEET_KELAYAKAN]: ['peringkat', 'daerah'],
    [SHEET_PERCUBAAN]: ['attempt_id', 'peringkat', 'masa_mula', 'ic', 'nama', 'daerah', 'set', 'soalan_ids', 'status', 'topik_lapan'],
    [SHEET_KEPUTUSAN]: ['attempt_id', 'peringkat', 'masa_hantar', 'ic', 'nama', 'daerah', 'set', 'betul', 'jumlah', 'skor', 'mata', 'jawapan_json', 'butiran_json'],
    [SHEET_LOG_REBUTAN]: ['masa', 'no_soalan', 'daerah', 'betul', 'mata', 'catatan'],
    [SHEET_MARKAH]: ['peringkat', 'daerah', 'mata', 'catatan', 'masa'],
  };
  if (H[name]) sh.appendRow(H[name]);
}

function headerMap_(sh) {
  const row = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  const m = {};
  row.forEach(function (h, i) { m[String(h).toLowerCase().trim()] = i; });
  return m;
}

// ---------- Normalisasi ----------
function normIc_(v) { return String(v || '').replace(/[\s-]/g, '').trim(); }
function normNama_(v) { return String(v || '').trim(); }
function normDaerah_(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, '_'); }
function normPin_(v) { return String(v || '').trim(); }
function normHuruf_(v) { return String(v || '').trim().toUpperCase(); }

// ---------- Tetapan ----------
function getTetapan_(kunci, fallback) {
  const sh = getSheet_(SHEET_TETAPAN);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).toLowerCase().trim() === kunci) {
      return String(data[r][1] || '').trim();
    }
  }
  return fallback != null ? fallback : '';
}
function setTetapan_(kunci, nilai) {
  const sh = getSheet_(SHEET_TETAPAN);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).toLowerCase().trim() === kunci) {
      sh.getRange(r + 1, 2).setValue(nilai);
      return;
    }
  }
  sh.appendRow([kunci, nilai]);
}
function getPeringkatAktif_() {
  return (getTetapan_('peringkat_aktif', 'TUTUP') || 'TUTUP').toUpperCase();
}

// ---------- Daerah ----------
function getDaerahList_() {
  const sh = getSheet_(SHEET_DAERAH);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const m = headerMap_(sh);
  const list = [];
  for (let r = 1; r < data.length; r++) {
    const kod = normDaerah_(data[r][m['kod']]);
    if (!kod) continue;
    list.push({ kod: kod, nama: String(data[r][m['nama']] || kod).trim() });
  }
  return list;
}
function daerahNamaMap_() {
  const map = {};
  getDaerahList_().forEach(function (d) { map[d.kod] = d.nama; });
  return map;
}
function isValidDaerah_(kod) {
  const list = getDaerahList_();
  if (!list.length) return true;
  return list.some(function (d) { return d.kod === kod; });
}

// ---------- Kelayakan ----------
function getKelayakan_(peringkat) {
  const sh = getSheet_(SHEET_KELAYAKAN);
  const data = sh.getDataRange().getValues();
  const set = {};
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).toUpperCase().trim() === peringkat) {
      set[normDaerah_(data[r][1])] = true;
    }
  }
  return set;
}
function isLayak_(peringkat, daerah) {
  // S1 terbuka kepada semua; S2/S3P1 perlu ada dalam Kelayakan.
  if (peringkat === 'S1') return true;
  const set = getKelayakan_(peringkat);
  if (!Object.keys(set).length) return false; // belum dikunci
  return !!set[daerah];
}

// ---------- Bank soalan (dengan cache gzip) ----------
function loadBankSoalan_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('bank_soalan_gz');
  if (hit) {
    try {
      const bytes = Utilities.base64Decode(hit);
      const json = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString();
      return JSON.parse(json);
    } catch (e) { /* fallback baca semula */ }
  }
  const sh = getSheet_(SHEET_SOALAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('Bank soalan kosong. Import questions.csv ke helaian Soalan.');
  const m = headerMap_(sh);
  const bank = {};
  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][m['id']] || '').trim();
    if (!id) continue;
    bank[id] = {
      id: id,
      topik: String(data[r][m['topik']] || '').toUpperCase().trim(),
      aras: String(data[r][m['aras']] || '').toLowerCase().trim(),
      soalan: String(data[r][m['soalan']] || ''),
      A: String(data[r][m['a']] || ''), B: String(data[r][m['b']] || ''),
      C: String(data[r][m['c']] || ''), D: String(data[r][m['d']] || ''),
      jawapan: normHuruf_(data[r][m['jawapan']]),
    };
  }
  try {
    const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(bank)));
    const b64 = Utilities.base64Encode(gz.getBytes());
    if (b64.length < 95000) cache.put('bank_soalan_gz', b64, 21600);
  } catch (e) { /* abaikan jika terlalu besar */ }
  return bank;
}

function loadBankS3P1_() {
  const sh = getSheet_(SHEET_S3P1);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('SoalanS3P1 kosong. Import soalan-s3p1.csv.');
  const m = headerMap_(sh);
  const bank = {}; // no -> soalan
  for (let r = 1; r < data.length; r++) {
    const no = String(data[r][m['no']] || '').trim();
    if (!no) continue;
    bank[no] = {
      id: no,
      set: Number(data[r][m['set']]),
      aras: String(data[r][m['aras']] || '').toLowerCase().trim(),
      soalan: String(data[r][m['soalan']] || ''),
      A: String(data[r][m['a']] || ''), B: String(data[r][m['b']] || ''),
      C: String(data[r][m['c']] || ''), D: String(data[r][m['d']] || ''),
      jawapan: normHuruf_(data[r][m['jawapan']]),
    };
  }
  return bank;
}

// ---------- Cabutan kertas (port dari scripts/simulate_draw.py) ----------
function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function sample_(pool, n, label) {
  if (pool.length < n) throw new Error('Soalan tidak cukup untuk ' + label + ' (perlu ' + n + ').');
  return shuffle_(pool).slice(0, n);
}
function buildKertas_(bank, excludeSet) {
  const exclude = excludeSet || {};
  const topikLapan = shuffle_(TOPIK_LIST)[0];
  let ids = [];
  TOPIK_LIST.forEach(function (topik) {
    const nTing = topik === topikLapan ? 4 : 3;
    const sed = [], ting = [];
    Object.keys(bank).forEach(function (id) {
      if (exclude[id]) return;
      const q = bank[id];
      if (q.topik !== topik) return;
      if (q.aras === 'sederhana') sed.push(id);
      else if (q.aras === 'tinggi') ting.push(id);
    });
    ids = ids.concat(sample_(sed, 4, topik + ' sederhana'),
                     sample_(ting, nTing, topik + ' tinggi'));
  });
  if (ids.length !== JUMLAH_SOALAN) {
    throw new Error('Cabutan gagal: dijangka ' + JUMLAH_SOALAN + ', dapat ' + ids.length);
  }
  return { ids: shuffle_(ids), topik_lapan: topikLapan };
}

// Kumpul semua soalan_ids yang pernah diterima IC ini (untuk "tiada ulang").
function servedIdsForIc_(ic) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const m = headerMap_(sh);
  const served = {};
  for (let r = 1; r < data.length; r++) {
    if (normIc_(data[r][m['ic']]) !== ic) continue;
    String(data[r][m['soalan_ids']] || '').split(',').forEach(function (s) {
      const id = s.trim(); if (id) served[id] = true;
    });
  }
  return served;
}

function stripJawapan_(qs) {
  return qs.map(function (q) {
    return { id: q.id, soalan: q.soalan, A: q.A, B: q.B, C: q.C, D: q.D };
  });
}
function qsFromIds_(bank, ids) {
  return ids.map(function (id) {
    if (!bank[id]) throw new Error('Soalan id ' + id + ' tidak dijumpai.');
    return bank[id];
  });
}
function gred_(qs, jawapanMap) {
  let betul = 0;
  const butiran = [];
  qs.forEach(function (q, i) {
    const pel = normHuruf_(jawapanMap[q.id]);
    const ok = pel === q.jawapan;
    if (ok) betul++;
    butiran.push({
      id: q.id, topik: q.topik || '', aras: q.aras || '', nombor: i + 1,
      soalan: q.soalan, jawapan_pelajar: pel || '-', jawapan_betul: q.jawapan, betul: ok,
    });
  });
  const jumlah = qs.length;
  return { betul: betul, jumlah: jumlah, skor: jumlah ? Math.round((betul / jumlah) * 100) : 0, butiran: butiran };
}

// ---------- Masa ----------
function toMs_(v) {
  if (v instanceof Date) return v.getTime();
  const d = new Date(v);
  return isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}
function fmtMasa_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  return String(v || '');
}
function fmtTempoh_(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = function (n) { return n < 10 ? '0' + n : '' + n; };
  if (h > 0) return p(h) + ' jam ' + p(m) + ' min ' + p(sec) + ' saat';
  if (m > 0) return m + ' min ' + p(sec) + ' saat';
  return sec + ' saat';
}
function timingS1S2_(masaMula) {
  const start = toMs_(masaMula), end = start + TEMPOH_KUIZ_MS;
  return {
    masa_mula_ms: start, batas_masa_ms: end,
    masa_mula_label: fmtMasa_(masaMula), batas_masa_label: fmtMasa_(new Date(end)),
    tempoh_kuiz_minit: Math.round(TEMPOH_KUIZ_MS / 60000),
  };
}

// ---------- Percubaan ----------
function appendPercubaan_(v) {
  getSheet_(SHEET_PERCUBAAN).appendRow([
    v.attemptId, v.peringkat, v.masaMula, v.ic, v.nama, v.daerah,
    v.set || '', v.soalanIds, v.status, v.topikLapan || '',
  ]);
}
function newAttemptId_(peringkat) {
  return peringkat + '-' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') +
    '-' + Math.floor(Math.random() * 10000);
}

function findAttempt_(pred) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const m = headerMap_(sh);
  for (let r = data.length - 1; r >= 1; r--) {
    const row = {
      row: r + 1,
      attempt_id: String(data[r][m['attempt_id']]),
      peringkat: String(data[r][m['peringkat']] || '').toUpperCase(),
      ic: normIc_(data[r][m['ic']]),
      nama: String(data[r][m['nama']] || ''),
      daerah: normDaerah_(data[r][m['daerah']]),
      set: data[r][m['set']] !== '' ? Number(data[r][m['set']]) : null,
      soalan_ids: String(data[r][m['soalan_ids']] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      status: String(data[r][m['status']] || ''),
      masa_mula: data[r][m['masa_mula']],
      topik_lapan: String(data[r][m['topik_lapan']] || ''),
    };
    if (pred(row)) return row;
  }
  return null;
}

// ---------- Pelajar: getInit ----------
function getInit() {
  const peringkat = getPeringkatAktif_();
  return {
    ok: true,
    peringkat_aktif: peringkat,
    peringkat_label: PERINGKAT_LABEL[peringkat] || peringkat,
    dibuka: PERINGKAT_PELAJAR.indexOf(peringkat) >= 0,
    daerah: getDaerahList_(),
  };
}

// ---------- Pelajar: startExam ----------
function startExam(ic, nama, daerah) {
  const icN = normIc_(ic), namaN = normNama_(nama), daerahN = normDaerah_(daerah);
  const peringkat = getPeringkatAktif_();

  if (PERINGKAT_PELAJAR.indexOf(peringkat) < 0) {
    return { ok: false, ralat: 'Peperiksaan belum dibuka. Sila tunggu arahan pengawas.' };
  }
  if (!icN || icN.length < 6) return { ok: false, ralat: 'No. Kad Pengenalan tidak sah.' };
  if (!namaN) return { ok: false, ralat: 'Nama penuh diperlukan.' };
  if (!daerahN) return { ok: false, ralat: 'Sila pilih daerah.' };
  if (!isValidDaerah_(daerahN)) return { ok: false, ralat: 'Daerah tidak sah.' };
  if (!isLayak_(peringkat, daerahN)) {
    return { ok: false, ralat: 'Daerah anda tidak layak untuk peringkat ini.' };
  }

  if (peringkat === 'S3P1') return startS3P1_(icN, namaN, daerahN);
  return startS1S2_(peringkat, icN, namaN, daerahN);
}

function startS1S2_(peringkat, icN, namaN, daerahN) {
  const bank = loadBankSoalan_();

  // Sudah hantar?
  const done = findAttempt_(function (r) {
    return r.peringkat === peringkat && r.ic === icN && r.status === STATUS_SELESAI;
  });
  if (done) {
    return { ok: false, sudah_hantar: true, ralat: 'Anda telah menghantar peperiksaan ini.',
             mesej_terima_kasih: MSJ_TERIMA_KASIH };
  }

  // Sambung percubaan sedang berjalan?
  const active = findAttempt_(function (r) {
    return r.peringkat === peringkat && r.ic === icN && r.status === STATUS_SEDANG;
  });
  if (active) {
    const t = timingS1S2_(active.masa_mula);
    if (Date.now() > t.batas_masa_ms) {
      return { ok: false, ralat: 'Masa kuiz 1 jam telah tamat. Sila hubungi pengawas.' };
    }
    return Object.assign({
      ok: true, peringkat: peringkat, attempt_id: active.attempt_id,
      nama: active.nama || namaN, daerah: active.daerah || daerahN,
      soalan: stripJawapan_(qsFromIds_(bank, active.soalan_ids)),
      jumlah: active.soalan_ids.length, sambungan: true,
    }, t);
  }

  // Cabut kertas baharu (S2 kecualikan soalan yang pernah diterima IC ini)
  const exclude = peringkat === 'S2' ? servedIdsForIc_(icN) : {};
  const kertas = buildKertas_(bank, exclude);

  // Kunci semasa tulis untuk elak perlumbaan / hantar berganda
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const dup = findAttempt_(function (r) { return r.peringkat === peringkat && r.ic === icN; });
    if (dup) {
      if (dup.status === STATUS_SELESAI) {
        return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
      }
      const t = timingS1S2_(dup.masa_mula);
      return Object.assign({
        ok: true, peringkat: peringkat, attempt_id: dup.attempt_id, nama: dup.nama || namaN,
        daerah: dup.daerah, soalan: stripJawapan_(qsFromIds_(bank, dup.soalan_ids)),
        jumlah: dup.soalan_ids.length, sambungan: true,
      }, t);
    }
    const attemptId = newAttemptId_(peringkat);
    const masaMula = new Date();
    appendPercubaan_({
      attemptId: attemptId, peringkat: peringkat, masaMula: masaMula, ic: icN, nama: namaN,
      daerah: daerahN, soalanIds: kertas.ids.join(','), status: STATUS_SEDANG,
      topikLapan: kertas.topik_lapan,
    });
    return Object.assign({
      ok: true, peringkat: peringkat, attempt_id: attemptId, nama: namaN, daerah: daerahN,
      soalan: stripJawapan_(qsFromIds_(bank, kertas.ids)), jumlah: kertas.ids.length, sambungan: false,
    }, timingS1S2_(masaMula));
  } finally {
    lock.releaseLock();
  }
}

function startS3P1_(icN, namaN, daerahN) {
  const bank = loadBankS3P1_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Satu kertas sepasukan (per daerah). Sambung jika sudah wujud.
    const team = findAttempt_(function (r) { return r.peringkat === 'S3P1' && r.daerah === daerahN; });
    if (team) {
      if (team.status === STATUS_SELESAI) {
        return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH,
                 ralat: 'Pasukan anda telah menghantar.' };
      }
      return {
        ok: true, peringkat: 'S3P1', attempt_id: team.attempt_id, nama: team.nama, daerah: daerahN,
        set: team.set, soalan: stripJawapan_(qsFromIds_(bank, team.soalan_ids)),
        jumlah: team.soalan_ids.length, saat_sesoalan: S3P1_SAAT_SESOALAN,
        mata_sesoalan: S3P1_MATA_SESOALAN, sambungan: true,
      };
    }
    // Set mana sudah diambil pasukan lain?
    const taken = {};
    const sh = getSheet_(SHEET_PERCUBAAN);
    const data = sh.getDataRange().getValues();
    const m = headerMap_(sh);
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][m['peringkat']]).toUpperCase() === 'S3P1') {
        const s = Number(data[r][m['set']]); if (s) taken[s] = true;
      }
    }
    let avail = [];
    for (let s = 1; s <= S3P1_SET_COUNT; s++) if (!taken[s]) avail.push(s);
    if (!avail.length) for (let s = 1; s <= S3P1_SET_COUNT; s++) avail.push(s);
    const setNo = shuffle_(avail)[0];

    // 10 soalan set ini (ikut susunan asal 1..10, boleh kocok jika mahu)
    const ids = Object.keys(bank).filter(function (no) { return bank[no].set === setNo; })
      .sort(function (a, b) { return Number(a) - Number(b); });
    if (ids.length !== S3P1_SOALAN) {
      throw new Error('Set ' + setNo + ' tidak mempunyai ' + S3P1_SOALAN + ' soalan.');
    }
    const attemptId = newAttemptId_('S3P1');
    appendPercubaan_({
      attemptId: attemptId, peringkat: 'S3P1', masaMula: new Date(), ic: icN, nama: namaN,
      daerah: daerahN, set: setNo, soalanIds: ids.join(','), status: STATUS_SEDANG, topikLapan: '',
    });
    return {
      ok: true, peringkat: 'S3P1', attempt_id: attemptId, nama: namaN, daerah: daerahN, set: setNo,
      soalan: stripJawapan_(qsFromIds_(bank, ids)), jumlah: ids.length,
      saat_sesoalan: S3P1_SAAT_SESOALAN, mata_sesoalan: S3P1_MATA_SESOALAN, sambungan: false,
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Pelajar: submitExam ----------
function submitExam(ic, attemptId, jawapan) {
  const icN = normIc_(ic);
  if (!icN) return { ok: false, ralat: 'IC diperlukan.' };
  if (!attemptId) return { ok: false, ralat: 'attempt_id diperlukan.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const attempt = findAttempt_(function (r) { return r.attempt_id === String(attemptId); });
    if (!attempt) return { ok: false, ralat: 'Percubaan tidak dijumpai.' };
    // S3P1 = kertas sepasukan, mana-mana ahli daerah boleh hantar; S1/S2 mesti sepadan IC.
    if (attempt.peringkat !== 'S3P1' && attempt.ic !== icN) {
      return { ok: false, ralat: 'Percubaan tidak sepadan dengan IC.' };
    }
    if (attempt.status === STATUS_SELESAI) {
      return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH,
               ralat: 'Jawapan telah dihantar sebelum ini.' };
    }

    let bank, mata, skor, graded;
    if (attempt.peringkat === 'S3P1') {
      bank = loadBankS3P1_();
      graded = gred_(qsFromIds_(bank, attempt.soalan_ids), jawapan || {});
      mata = graded.betul * S3P1_MATA_SESOALAN;
      skor = graded.skor;
    } else {
      const t = timingS1S2_(attempt.masa_mula);
      if (Date.now() > t.batas_masa_ms) {
        return { ok: false, ralat: 'Masa kuiz 1 jam telah tamat. Sila hubungi pengawas.' };
      }
      bank = loadBankSoalan_();
      graded = gred_(qsFromIds_(bank, attempt.soalan_ids), jawapan || {});
      mata = graded.betul;
      skor = graded.skor;
    }

    // Tanda selesai
    const shP = getSheet_(SHEET_PERCUBAAN);
    const mp = headerMap_(shP);
    shP.getRange(attempt.row, mp['status'] + 1).setValue(STATUS_SELESAI);

    // Rekod keputusan
    getSheet_(SHEET_KEPUTUSAN).appendRow([
      attempt.attempt_id, attempt.peringkat, new Date(), icN, attempt.nama, attempt.daerah,
      attempt.set || '', graded.betul, graded.jumlah, skor, mata,
      JSON.stringify(jawapan || {}), JSON.stringify(graded.butiran),
    ]);

    return { ok: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Pelajar: getResult ----------
function getResult(ic, daerah) {
  const icN = normIc_(ic);
  const peringkat = getPeringkatAktif_();
  if (!icN) return { ok: false, ralat: 'IC diperlukan.' };
  const daerahN = normDaerah_(daerah);
  const done = findAttempt_(function (r) {
    return r.peringkat === peringkat && r.status === STATUS_SELESAI &&
      (peringkat === 'S3P1' ? r.daerah === daerahN : r.ic === icN);
  });
  if (done) return { ok: true, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
  return { ok: false, ralat: 'Tiada rekod peperiksaan.' };
}

// ============================================================
// PENTADBIR (satu ADMIN_PIN)
// ============================================================
function requirePin_(pin) {
  const admin = getAdminPin_();
  if (!admin) return { ok: false, ralat: 'ADMIN_PIN belum dikonfigurasi.' };
  if (normPin_(pin) !== admin) return { ok: false, ralat: 'PIN tidak sah.' };
  return { ok: true };
}

function loadKeputusan_(peringkat) {
  const sh = getSheet_(SHEET_KEPUTUSAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const m = headerMap_(sh);
  const masaMula = attemptMasaMulaMap_();
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][m['peringkat']]).toUpperCase() !== peringkat) continue;
    const ic = normIc_(data[r][m['ic']]);
    const attempt = String(data[r][m['attempt_id']]);
    const start = toMs_(masaMula[attempt]);
    const end = toMs_(data[r][m['masa_hantar']]);
    const tempoh = (start <= end && start < Number.MAX_SAFE_INTEGER) ? end - start : Number.MAX_SAFE_INTEGER;
    rows.push({
      attempt_id: attempt, ic: ic, nama: String(data[r][m['nama']] || ''),
      daerah: normDaerah_(data[r][m['daerah']]), set: data[r][m['set']],
      betul: Number(data[r][m['betul']]), jumlah: Number(data[r][m['jumlah']]),
      skor: Number(data[r][m['skor']]), mata: Number(data[r][m['mata']] || 0),
      masa_hantar: data[r][m['masa_hantar']], tempoh_ms: tempoh, tempoh_label: fmtTempoh_(tempoh),
      jawapan_json: data[r][m['jawapan_json']], butiran_json: data[r][m['butiran_json']],
      row: r,
    });
  }
  return rows;
}
function attemptMasaMulaMap_() {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const m = headerMap_(sh);
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][m['attempt_id']] || '').trim();
    if (id) map[id] = data[r][m['masa_mula']];
  }
  return map;
}

// Ranking individu (ambil percubaan terbaik per IC) + ranking pasukan.
function buildRanking_(peringkat) {
  const rows = loadKeputusan_(peringkat);
  const namaMap = daerahNamaMap_();

  // Individu terbaik per IC
  const bestByIc = {};
  rows.forEach(function (row) {
    const cur = bestByIc[row.ic];
    if (!cur || row.skor > cur.skor || (row.skor === cur.skor && row.tempoh_ms < cur.tempoh_ms)) {
      bestByIc[row.ic] = row;
    }
  });
  const individu = Object.keys(bestByIc).map(function (k) { return bestByIc[k]; });
  individu.sort(function (a, b) { return b.skor !== a.skor ? b.skor - a.skor : a.tempoh_ms - b.tempoh_ms; });
  const individuOut = individu.map(function (r, i) {
    return { kedudukan: i + 1, ic: r.ic, nama: r.nama, daerah: r.daerah,
             nama_daerah: namaMap[r.daerah] || r.daerah, betul: r.betul, jumlah: r.jumlah,
             skor: r.skor, mata: r.mata, tempoh_label: r.tempoh_label };
  });

  // Pasukan = daerah. Markah = jumlah 3 markah tertinggi; masa = jumlah tempoh 3 itu.
  const byDaerah = {};
  individu.forEach(function (r) { (byDaerah[r.daerah] = byDaerah[r.daerah] || []).push(r); });
  const pasukan = Object.keys(byDaerah).map(function (d) {
    const anggota = byDaerah[d].slice().sort(function (a, b) {
      return b.skor !== a.skor ? b.skor - a.skor : a.tempoh_ms - b.tempoh_ms;
    }).slice(0, 3);
    let mata = 0, skor = 0, tempoh = 0;
    anggota.forEach(function (a) { mata += a.mata; skor += a.skor; tempoh += a.tempoh_ms; });
    return { daerah: d, nama_daerah: namaMap[d] || d, bil_ahli: byDaerah[d].length,
             jumlah_skor: skor, jumlah_mata: mata, tempoh_ms: tempoh, tempoh_label: fmtTempoh_(tempoh) };
  });
  pasukan.sort(function (a, b) { return b.jumlah_skor !== a.jumlah_skor ? b.jumlah_skor - a.jumlah_skor : a.tempoh_ms - b.tempoh_ms; });
  pasukan.forEach(function (p, i) { p.kedudukan = i + 1; });

  return { individu: individuOut, pasukan: pasukan };
}

function adminState(pin) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const counts = {};
  const sh = getSheet_(SHEET_KEPUTUSAN);
  const data = sh.getDataRange().getValues();
  const m = headerMap_(sh);
  for (let r = 1; r < data.length; r++) {
    const p = String(data[r][m['peringkat']]).toUpperCase();
    counts[p] = (counts[p] || 0) + 1;
  }
  return {
    ok: true, peringkat_aktif: getPeringkatAktif_(),
    peringkat_label: PERINGKAT_LABEL, jumlah_keputusan: counts,
    daerah: getDaerahList_(),
    kelayakan: { S2: Object.keys(getKelayakan_('S2')), S3P1: Object.keys(getKelayakan_('S3P1')) },
  };
}

function adminSetPeringkat(pin, peringkat) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const p = String(peringkat || '').toUpperCase();
  const sah = ['S1', 'S2', 'S3P1', 'S3P2', 'S3P3', 'TUTUP'];
  if (sah.indexOf(p) < 0) return { ok: false, ralat: 'Peringkat tidak sah.' };
  setTetapan_('peringkat_aktif', p);
  return { ok: true, peringkat_aktif: p, mesej: 'Peringkat aktif: ' + (PERINGKAT_LABEL[p] || p) };
}

function adminRanking(pin, peringkat) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const p = String(peringkat || getPeringkatAktif_()).toUpperCase();
  const rk = buildRanking_(p);
  return { ok: true, peringkat: p, peringkat_label: PERINGKAT_LABEL[p] || p,
           individu: rk.individu, pasukan: rk.pasukan };
}

function adminReview(pin, peringkat, ic) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const icN = normIc_(ic);
  if (!icN) return adminRanking(pin, peringkat);
  const p = String(peringkat || getPeringkatAktif_()).toUpperCase();
  const rows = loadKeputusan_(p).filter(function (r) { return r.ic === icN; });
  if (!rows.length) return { ok: false, ralat: 'Tiada rekod untuk IC ini pada peringkat ' + p + '.' };
  rows.sort(function (a, b) { return b.skor - a.skor; });
  const row = rows[0];
  let butiran = [];
  try { butiran = JSON.parse(row.butiran_json || '[]'); } catch (e) { butiran = []; }
  const namaMap = daerahNamaMap_();
  return {
    ok: true, peringkat: p, ic: icN, nama: row.nama, daerah: row.daerah,
    nama_daerah: namaMap[row.daerah] || row.daerah, betul: row.betul, jumlah: row.jumlah,
    salah: row.jumlah - row.betul, skor: row.skor, mata: row.mata,
    masa_hantar: fmtMasa_(row.masa_hantar), tempoh_label: row.tempoh_label, butiran: butiran,
  };
}

// Kunci pasukan yang layak ke peringkat seterusnya.
function adminLock(pin, peringkat, daerahList) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const p = String(peringkat || '').toUpperCase();
  if (['S2', 'S3P1'].indexOf(p) < 0) return { ok: false, ralat: 'Hanya S2 atau S3P1 boleh dikunci.' };
  let list = daerahList;
  if (typeof list === 'string') list = list.split(',');
  list = (list || []).map(normDaerah_).filter(Boolean);
  if (!list.length) return { ok: false, ralat: 'Senarai daerah kosong.' };

  const sh = getSheet_(SHEET_KELAYAKAN);
  const data = sh.getDataRange().getValues();
  // Padam baris sedia ada untuk peringkat ini
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][0]).toUpperCase().trim() === p) sh.deleteRow(r + 1);
  }
  list.forEach(function (d) { sh.appendRow([p, d]); });
  return { ok: true, peringkat: p, daerah: list, mesej: list.length + ' pasukan dikunci untuk ' + p + '.' };
}

// ---------- Rebutan (S3P2) ----------
function loadBankRebutan_() {
  const sh = getSheet_(SHEET_REBUTAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('SoalanRebutan kosong. Import soalan-rebutan.csv.');
  const m = headerMap_(sh);
  const list = [];
  for (let r = 1; r < data.length; r++) {
    const no = String(data[r][m['no']] || '').trim();
    if (!no) continue;
    list.push({
      no: Number(no), topik: String(data[r][m['topik']] || ''), aras: String(data[r][m['aras']] || ''),
      soalan: String(data[r][m['soalan']] || ''),
      A: String(data[r][m['a']] || ''), B: String(data[r][m['b']] || ''),
      C: String(data[r][m['c']] || ''), D: String(data[r][m['d']] || ''),
      jawapan: normHuruf_(data[r][m['jawapan']]),
    });
  }
  return list;
}
// Pilih 8 drpd 12 (disimpan dalam Tetapan supaya kekal antara muat semula).
function adminRebutanSoalan(pin, pilihSemula) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const bank = loadBankRebutan_();
  let pilihan = (getTetapan_('rebutan_pilihan', '') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (pilihSemula || !pilihan.length) {
    pilihan = shuffle_(bank.map(function (q) { return String(q.no); })).slice(0, REBUTAN_PILIH);
    setTetapan_('rebutan_pilihan', pilihan.join(','));
  }
  const byNo = {}; bank.forEach(function (q) { byNo[q.no] = q; });
  const soalan = pilihan.map(function (no, i) {
    const q = byNo[no]; if (!q) return null;
    return { urutan: i + 1, no: q.no, topik: q.topik, soalan: q.soalan,
             A: q.A, B: q.B, C: q.C, D: q.D, jawapan: q.jawapan };
  }).filter(Boolean);
  return { ok: true, soalan: soalan, daerah_layak: Object.keys(getKelayakan_('S3P1')) };
}
function adminRebutanScore(pin, noSoalan, daerah, betul, mata) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const daerahN = normDaerah_(daerah);
  if (!daerahN) return { ok: false, ralat: 'Daerah diperlukan.' };
  const isBetul = betul === true || String(betul) === 'true';
  const m = Number(mata != null ? mata : (isBetul ? 5 : 0));
  getSheet_(SHEET_LOG_REBUTAN).appendRow([new Date(), noSoalan || '', daerahN, isBetul, m, isBetul ? 'betul' : 'salah/tiada']);
  return { ok: true, mesej: 'Direkod: ' + daerahN + ' ' + (m >= 0 ? '+' : '') + m + ' mata.' };
}

// ---------- Markah manual (S3P3) ----------
function adminSetManual(pin, peringkat, daerah, mata, catatan) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const p = String(peringkat || 'S3P3').toUpperCase();
  const daerahN = normDaerah_(daerah);
  if (!daerahN) return { ok: false, ralat: 'Daerah diperlukan.' };
  const m = Number(mata || 0);
  const sh = getSheet_(SHEET_MARKAH);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).toUpperCase() === p && normDaerah_(data[r][1]) === daerahN) {
      sh.getRange(r + 1, 3).setValue(m);
      sh.getRange(r + 1, 4).setValue(catatan || '');
      sh.getRange(r + 1, 5).setValue(new Date());
      return { ok: true, mesej: 'Markah ' + p + ' ' + daerahN + ' dikemas kini: ' + m };
    }
  }
  sh.appendRow([p, daerahN, m, catatan || '', new Date()]);
  return { ok: true, mesej: 'Markah ' + p + ' ' + daerahN + ' disimpan: ' + m };
}

// ---------- Kedudukan akhir (S3 terkumpul) ----------
function adminFinal(pin) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const namaMap = daerahNamaMap_();
  const agg = {}; // daerah -> {s3p1, s3p2, s3p3}
  function ensure(d) { if (!agg[d]) agg[d] = { daerah: d, nama_daerah: namaMap[d] || d, s3p1: 0, s3p2: 0, s3p3: 0 }; return agg[d]; }

  // S3P1: markah kertas pasukan
  loadKeputusan_('S3P1').forEach(function (r) { ensure(r.daerah).s3p1 += r.mata; });

  // S3P2: jumlah log rebutan
  const shR = getSheet_(SHEET_LOG_REBUTAN);
  const dataR = shR.getDataRange().getValues();
  const mR = headerMap_(shR);
  for (let r = 1; r < dataR.length; r++) {
    const d = normDaerah_(dataR[r][mR['daerah']]); if (!d) continue;
    ensure(d).s3p2 += Number(dataR[r][mR['mata']] || 0);
  }

  // S3P3: markah manual
  const shM = getSheet_(SHEET_MARKAH);
  const dataM = shM.getDataRange().getValues();
  for (let r = 1; r < dataM.length; r++) {
    if (String(dataM[r][0]).toUpperCase() === 'S3P3') ensure(normDaerah_(dataM[r][1])).s3p3 += Number(dataM[r][2] || 0);
  }

  const list = Object.keys(agg).map(function (d) {
    const a = agg[d]; a.jumlah = a.s3p1 + a.s3p2 + a.s3p3; return a;
  });
  list.sort(function (a, b) { return b.jumlah - a.jumlah; });
  list.forEach(function (a, i) { a.kedudukan = i + 1; });
  return { ok: true, kedudukan: list };
}

// ---------- Reset ----------
function adminReset(pin, skop) {
  const chk = requirePin_(pin); if (!chk.ok) return chk;
  const s = String(skop || 'semua').toLowerCase();
  function clear(name) {
    const sh = getSheet_(name);
    const last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
  }
  if (s === 'semua' || s === 'percubaan') { clear(SHEET_PERCUBAAN); clear(SHEET_KEPUTUSAN); }
  if (s === 'semua') { clear(SHEET_LOG_REBUTAN); clear(SHEET_MARKAH); clear(SHEET_KELAYAKAN); setTetapan_('rebutan_pilihan', ''); }
  return { ok: true, mesej: 'Reset (' + s + ') selesai. Bank soalan & daerah tidak diubah.' };
}
