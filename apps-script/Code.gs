/**
 * Peperiksaan dalam talian — Google Apps Script backend
 * Script properties: SPREADSHEET_ID, ADMIN_PIN (fallback jika helaian Pentadbir kosong)
 */

const JUMLAH_SOALAN = 50;
const SHEET_SOALAN = 'Soalan';
const SHEET_PERCUBAAN = 'Percubaan';
const SHEET_KEPUTUSAN = 'Keputusan';
const SHEET_DAERAH = 'Daerah';
const SHEET_PENTADBIR = 'Pentadbir';
const STATUS_SEDANG = 'sedang';
const STATUS_SELESAI = 'selesai';
const PERANAN_DAERAH = 'daerah';
const PERANAN_NEGERI = 'negeri';
const KOD_NEGERI = 'NEGERI';
const TOPIK_LIST = [
  'AKIDAH',
  'ALQURAN',
  'JAWI',
  'SIRAH',
  'HADIS',
  'IBADAH',
  'ADAB',
];
const MSJ_TERIMA_KASIH =
  'Terima kasih. Jawapan anda telah direkodkan. Keputusan akan diumumkan oleh pihak pengurusan.';
const TEMPOH_KUIZ_MS = 60 * 60 * 1000;

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (err) {
        return jsonResponse({ ok: false, ralat: 'JSON tidak sah.' });
      }
    }
    const action = (params.action || body.action || '').trim();
    const payload = Object.assign({}, params, body);
    delete payload.action;

    switch (action) {
      case 'getDaerahList':
        return jsonResponse(getDaerahList());
      case 'startExam':
        return jsonResponse(
          startExam(payload.ic, payload.nama, payload.daerah)
        );
      case 'submitExam':
        return jsonResponse(
          submitExam(payload.ic, payload.attempt_id, payload.jawapan)
        );
      case 'getResult':
        return jsonResponse(getResult(payload.ic, payload.daerah));
      case 'adminReview':
        return jsonResponse(adminReview(payload.pin, payload.ic));
      case 'adminReset':
        return jsonResponse(adminReset(payload.pin));
      case 'adminSetPin':
        return jsonResponse(
          adminSetPin(payload.pin, payload.kod_daerah, payload.pin_baru)
        );
      default:
        return jsonResponse({ ok: false, ralat: 'Tindakan tidak dikenali.' });
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      ralat: err.message || String(err),
    });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty(
    'SPREADSHEET_ID'
  );
  if (!id) {
    throw new Error(
      'SPREADSHEET_ID belum ditetapkan dalam Script properties.'
    );
  }
  return id;
}

function getLegacyAdminPin_() {
  return (
    PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || ''
  ).trim();
}

function getSs_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}

function getSheet_(name) {
  const ss = getSs_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    initSheetHeaders_(sh, name);
  }
  return sh;
}

function initSheetHeaders_(sh, name) {
  if (sh.getLastRow() > 0) return;
  if (name === SHEET_SOALAN) {
    sh.appendRow([
      'id',
      'topik',
      'aras',
      'soalan',
      'A',
      'B',
      'C',
      'D',
      'jawapan',
    ]);
  } else if (name === SHEET_DAERAH) {
    sh.appendRow(['kod', 'nama']);
  } else if (name === SHEET_PENTADBIR) {
    sh.appendRow(['kod_daerah', 'nama_daerah', 'pin', 'peranan']);
  } else if (name === SHEET_PERCUBAAN) {
    sh.appendRow([
      'attempt_id',
      'masa_mula',
      'ic',
      'nama',
      'daerah',
      'soalan_ids',
      'status',
      'topik_lapan',
    ]);
  } else if (name === SHEET_KEPUTUSAN) {
    sh.appendRow([
      'attempt_id',
      'masa_hantar',
      'ic',
      'nama',
      'daerah',
      'betul',
      'jumlah',
      'skor',
      'jawapan_json',
      'butiran_json',
    ]);
  }
}

function normalizeIc_(ic) {
  return String(ic || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .trim();
}

function normalizeNama_(nama) {
  return String(nama || '').trim();
}

function normalizeDaerah_(daerah) {
  return String(daerah || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function normalizePin_(pin) {
  return String(pin || '').trim();
}

function headerIndex_(header, names) {
  const out = {};
  names.forEach(function (n) {
    out[n] = header.indexOf(n);
  });
  return out;
}

function getDaerahList() {
  const sh = getSheet_(SHEET_DAERAH);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    return { ok: true, daerah: [] };
  }
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cKod = header.indexOf('kod');
  const cNama = header.indexOf('nama');
  const list = [];
  for (let r = 1; r < data.length; r++) {
    const kod = normalizeDaerah_(data[r][cKod]);
    if (!kod) continue;
    list.push({
      kod: kod,
      nama: String(data[r][cNama] || kod).trim(),
    });
  }
  return { ok: true, daerah: list };
}

function loadDaerahNamaMap_() {
  const result = getDaerahList();
  const map = {};
  (result.daerah || []).forEach(function (d) {
    map[d.kod] = d.nama;
  });
  return map;
}

function isValidDaerahKod_(kod) {
  const norm = normalizeDaerah_(kod);
  if (!norm) return false;
  const list = getDaerahList().daerah || [];
  if (!list.length) return true;
  return list.some(function (d) {
    return d.kod === norm;
  });
}

function loadPentadbirRows_() {
  const sh = getSheet_(SHEET_PENTADBIR);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cKod = header.indexOf('kod_daerah');
  const cNama = header.indexOf('nama_daerah');
  const cPin = header.indexOf('pin');
  const cPeranan = header.indexOf('peranan');
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const pin = normalizePin_(data[r][cPin]);
    if (!pin) continue;
    rows.push({
      kod_daerah: normalizeDaerah_(data[r][cKod]),
      nama_daerah: String(data[r][cNama] || '').trim(),
      pin: pin,
      peranan: String(data[r][cPeranan] || PERANAN_DAERAH)
        .trim()
        .toLowerCase(),
      row: r + 1,
    });
  }
  return rows;
}

function verifyAdminPin_(pin) {
  const input = normalizePin_(pin);
  if (!input) {
    return { ok: false, ralat: 'PIN diperlukan.' };
  }

  const rows = loadPentadbirRows_();
  if (rows.length) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].pin === input) {
        return {
          ok: true,
          peranan: rows[i].peranan === PERANAN_NEGERI ? PERANAN_NEGERI : PERANAN_DAERAH,
          kod_daerah: rows[i].kod_daerah,
          nama_daerah: rows[i].nama_daerah || rows[i].kod_daerah,
        };
      }
    }
    return { ok: false, ralat: 'PIN tidak sah.' };
  }

  const legacy = getLegacyAdminPin_();
  if (!legacy) {
    return { ok: false, ralat: 'PIN pentadbir belum dikonfigurasi.' };
  }
  if (input !== legacy) {
    return { ok: false, ralat: 'PIN tidak sah.' };
  }
  return {
    ok: true,
    peranan: PERANAN_NEGERI,
    kod_daerah: KOD_NEGERI,
    nama_daerah: 'Peringkat Negeri',
  };
}

function requireNegeriPin_(pin) {
  const check = verifyAdminPin_(pin);
  if (!check.ok) return check;
  if (check.peranan !== PERANAN_NEGERI) {
    return {
      ok: false,
      ralat: 'Hanya PIN peringkat negeri dibenarkan untuk tindakan ini.',
    };
  }
  return check;
}

function isWeakPin_(pin) {
  const p = normalizePin_(pin);
  if (!/^\d{6,12}$/.test(p)) {
    return 'PIN mesti 6–12 digit nombor.';
  }
  if (/^(\d)\1+$/.test(p)) {
    return 'PIN terlalu mudah (semua digit sama).';
  }
  const asc = '012345678901234567890123456789012345678901234567890';
  const desc = '987654321098765432109876543210987654321098765432109876';
  if (asc.indexOf(p) >= 0 || desc.indexOf(p) >= 0) {
    return 'PIN terlalu mudah (urutan nombor).';
  }
  if (p === '123456' || p === '654321' || p === '111111' || p === '000000') {
    return 'PIN terlalu mudah.';
  }
  return '';
}

function clearSheetDataRows_(sheetName) {
  const sh = getSheet_(sheetName);
  const last = sh.getLastRow();
  if (last > 1) {
    sh.deleteRows(2, last - 1);
  }
}

function adminReset(pin) {
  const check = requireNegeriPin_(pin);
  if (!check.ok) return check;

  clearSheetDataRows_(SHEET_PERCUBAAN);
  clearSheetDataRows_(SHEET_KEPUTUSAN);

  return {
    ok: true,
    mesej:
      'Data Percubaan dan Keputusan telah dikosongkan. Bank soalan, daerah dan PIN tidak diubah.',
  };
}

function adminSetPin(pin, kodDaerah, pinBaru) {
  const check = requireNegeriPin_(pin);
  if (!check.ok) return check;

  const kod = normalizeDaerah_(kodDaerah);
  if (!kod || kod === KOD_NEGERI) {
    return { ok: false, ralat: 'Kod daerah tidak sah.' };
  }

  const weak = isWeakPin_(pinBaru);
  if (weak) {
    return { ok: false, ralat: weak };
  }

  const sh = getSheet_(SHEET_PENTADBIR);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    return { ok: false, ralat: 'Helaian Pentadbir kosong.' };
  }

  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cKod = header.indexOf('kod_daerah');
  const cPin = header.indexOf('pin');

  for (let r = 1; r < data.length; r++) {
    if (normalizeDaerah_(data[r][cKod]) === kod) {
      sh.getRange(r + 1, cPin + 1).setValue(normalizePin_(pinBaru));
      return {
        ok: true,
        mesej: 'PIN daerah ' + kod + ' telah dikemas kini.',
      };
    }
  }

  return { ok: false, ralat: 'Kod daerah tidak dijumpai dalam Pentadbir.' };
}

function loadQuestionBank_() {
  const sh = getSheet_(SHEET_SOALAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error(
      'Bank soalan kosong. Import data/questions.csv ke Sheet Soalan.'
    );
  }
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const idx = headerIndex_(header, [
    'id',
    'topik',
    'aras',
    'soalan',
    'a',
    'b',
    'c',
    'd',
    'jawapan',
  ]);
  const bank = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row[idx.id]) continue;
    const id = String(row[idx.id]).trim();
    bank[id] = {
      id: id,
      topik: String(row[idx.topik] || '').trim().toUpperCase(),
      aras: String(row[idx.aras] || '').trim().toLowerCase(),
      soalan: String(row[idx.soalan] || ''),
      A: String(row[idx.a] || ''),
      B: String(row[idx.b] || ''),
      C: String(row[idx.c] || ''),
      D: String(row[idx.d] || ''),
      jawapan: String(row[idx.jawapan] || '')
        .trim()
        .toUpperCase(),
    };
  }
  return bank;
}

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function sampleFromPool_(pool, n, label) {
  if (pool.length < n) {
    throw new Error(
      'Soalan tidak mencukupi untuk ' + label + ' (perlukan ' + n + ').'
    );
  }
  return shuffle_(pool).slice(0, n);
}

function buildExamPaper_(bank) {
  const topikLapan = shuffle_(TOPIK_LIST)[0];
  let ids = [];

  TOPIK_LIST.forEach(function (topik) {
    const isLapan = topik === topikLapan;
    const nTing = isLapan ? 4 : 3;
    const sedPool = [];
    const tingPool = [];
    Object.keys(bank).forEach(function (id) {
      const q = bank[id];
      if (q.topik !== topik) return;
      if (q.aras === 'sederhana') sedPool.push(id);
      else if (q.aras === 'tinggi') tingPool.push(id);
    });
    ids = ids.concat(
      sampleFromPool_(sedPool, 4, topik + ' sederhana'),
      sampleFromPool_(tingPool, nTing, topik + ' tinggi')
    );
  });

  if (ids.length !== JUMLAH_SOALAN) {
    throw new Error(
      'Cabutan gagal: dijangka ' + JUMLAH_SOALAN + ' soalan, diperoleh ' + ids.length
    );
  }

  return {
    ids: shuffle_(ids),
    topik_lapan: topikLapan,
  };
}

function getPercubaanHeaders_() {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const row = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return row.map(function (h) {
    return String(h).toLowerCase().trim();
  });
}

function rowMatchesDaerah_(rowDaerah, daerahNorm) {
  const rowNorm = normalizeDaerah_(rowDaerah);
  if (!daerahNorm) return true;
  if (!rowNorm) return true;
  return rowNorm === daerahNorm;
}

function findActiveAttempt_(ic, daerah) {
  const daerahNorm = normalizeDaerah_(daerah);
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cIc = header.indexOf('ic');
  const cNama = header.indexOf('nama');
  const cDaerah = header.indexOf('daerah');
  const cIds = header.indexOf('soalan_ids');
  const cStatus = header.indexOf('status');
  const cMula = header.indexOf('masa_mula');

  for (let r = data.length - 1; r >= 1; r--) {
    if (
      normalizeIc_(data[r][cIc]) === ic &&
      data[r][cStatus] === STATUS_SEDANG &&
      rowMatchesDaerah_(cDaerah >= 0 ? data[r][cDaerah] : '', daerahNorm)
    ) {
      return {
        row: r + 1,
        attempt_id: String(data[r][cAttempt]),
        masa_mula: cMula >= 0 ? data[r][cMula] : '',
        soalan_ids: String(data[r][cIds])
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
        nama: String(data[r][cNama]),
        daerah: cDaerah >= 0 ? normalizeDaerah_(data[r][cDaerah]) : daerahNorm,
      };
    }
  }
  return null;
}

function findFinishedAttempt_(ic, daerah) {
  const daerahNorm = normalizeDaerah_(daerah);
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cIc = header.indexOf('ic');
  const cDaerah = header.indexOf('daerah');
  const cStatus = header.indexOf('status');

  for (let r = data.length - 1; r >= 1; r--) {
    if (
      normalizeIc_(data[r][cIc]) === ic &&
      data[r][cStatus] === STATUS_SELESAI &&
      rowMatchesDaerah_(cDaerah >= 0 ? data[r][cDaerah] : '', daerahNorm)
    ) {
      return { attempt_id: String(data[r][cAttempt]) };
    }
  }
  return null;
}

function stripAnswers_(questions) {
  return questions.map(function (q) {
    return {
      id: q.id,
      soalan: q.soalan,
      A: q.A,
      B: q.B,
      C: q.C,
      D: q.D,
    };
  });
}

function buildQuestionsFromIds_(bank, ids) {
  return ids.map(function (id) {
    if (!bank[id]) {
      throw new Error('Soalan id ' + id + ' tidak dijumpai.');
    }
    return bank[id];
  });
}

function gradeAnswers_(questions, jawapanMap) {
  let betul = 0;
  const butiran = [];
  questions.forEach(function (q, i) {
    const student = String(jawapanMap[q.id] || '')
      .trim()
      .toUpperCase();
    const isCorrect = student === q.jawapan;
    if (isCorrect) betul++;
    butiran.push({
      id: q.id,
      topik: q.topik,
      aras: q.aras,
      nombor: i + 1,
      soalan: q.soalan,
      jawapan_pelajar: student || '-',
      jawapan_betul: q.jawapan,
      betul: isCorrect,
    });
  });
  const jumlah = questions.length;
  const skor = jumlah ? Math.round((betul / jumlah) * 100) : 0;
  return { betul: betul, jumlah: jumlah, skor: skor, butiran: butiran };
}

function newAttemptId_() {
  return (
    'ATT-' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') +
    '-' +
    Math.floor(Math.random() * 10000)
  );
}

function appendPercubaanRow_(values) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const header = getPercubaanHeaders_();
  const cDaerah = header.indexOf('daerah');
  if (cDaerah >= 0) {
    sh.appendRow([
      values.attemptId,
      values.masaMula,
      values.ic,
      values.nama,
      values.daerah,
      values.soalanIds,
      values.status,
      values.topikLapan,
    ]);
  } else {
    sh.appendRow([
      values.attemptId,
      values.masaMula,
      values.ic,
      values.nama,
      values.soalanIds,
      values.status,
      values.topikLapan,
    ]);
  }
}

function startExam(ic, nama, daerah) {
  const icNorm = normalizeIc_(ic);
  const namaNorm = normalizeNama_(nama);
  const daerahNorm = normalizeDaerah_(daerah);
  if (!icNorm || icNorm.length < 6) {
    return { ok: false, ralat: 'No. Kad Pengenalan tidak sah.' };
  }
  if (!namaNorm) {
    return { ok: false, ralat: 'Nama penuh diperlukan.' };
  }
  if (!daerahNorm) {
    return { ok: false, ralat: 'Sila pilih daerah.' };
  }
  if (!isValidDaerahKod_(daerahNorm)) {
    return { ok: false, ralat: 'Daerah tidak sah. Sila pilih semula.' };
  }

  const bank = loadQuestionBank_();
  const finished = findFinishedAttempt_(icNorm, daerahNorm);
  if (finished) {
    return {
      ok: false,
      ralat: 'Anda telah menghantar peperiksaan ini.',
      sudah_hantar: true,
      mesej_terima_kasih: MSJ_TERIMA_KASIH,
    };
  }

  let active = findActiveAttempt_(icNorm, daerahNorm);
  if (active) {
    const questions = buildQuestionsFromIds_(bank, active.soalan_ids);
    const timing = buildTimingInfo_(active.masa_mula);
    const now = Date.now();
    if (now > timing.batas_masa_ms) {
      return {
        ok: false,
        ralat:
          'Masa kuiz 1 jam telah tamat. Sila hubungi pengawas untuk bantuan.',
      };
    }
    return Object.assign(
      {
        ok: true,
        attempt_id: active.attempt_id,
        nama: active.nama || namaNorm,
        daerah: active.daerah || daerahNorm,
        soalan: stripAnswers_(questions),
        jumlah: questions.length,
        sambungan: true,
      },
      timing
    );
  }

  const paper = buildExamPaper_(bank);
  const attemptId = newAttemptId_();
  appendPercubaanRow_({
    attemptId: attemptId,
    masaMula: new Date(),
    ic: icNorm,
    nama: namaNorm,
    daerah: daerahNorm,
    soalanIds: paper.ids.join(','),
    status: STATUS_SEDANG,
    topikLapan: paper.topik_lapan,
  });

  const questions = buildQuestionsFromIds_(bank, paper.ids);
  const timing = buildTimingInfo_(new Date());
  return Object.assign(
    {
      ok: true,
      attempt_id: attemptId,
      nama: namaNorm,
      daerah: daerahNorm,
      soalan: stripAnswers_(questions),
      jumlah: questions.length,
      sambungan: false,
    },
    timing
  );
}

function getAttemptRow_(attemptId, ic) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cIc = header.indexOf('ic');
  const cNama = header.indexOf('nama');
  const cDaerah = header.indexOf('daerah');
  const cIds = header.indexOf('soalan_ids');
  const cStatus = header.indexOf('status');
  const cMula = header.indexOf('masa_mula');
  const cTopikLapan = header.indexOf('topik_lapan');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][cAttempt]) === String(attemptId)) {
      if (normalizeIc_(data[r][cIc]) !== ic) {
        return { error: 'Percubaan tidak sepadan dengan IC.' };
      }
      return {
        row: r + 1,
        attempt_id: String(data[r][cAttempt]),
        ic: normalizeIc_(data[r][cIc]),
        nama: String(data[r][cNama]),
        daerah: cDaerah >= 0 ? normalizeDaerah_(data[r][cDaerah]) : '',
        masa_mula: cMula >= 0 ? data[r][cMula] : '',
        soalan_ids: String(data[r][cIds])
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
        status: String(data[r][cStatus]),
        topik_lapan:
          cTopikLapan >= 0 ? String(data[r][cTopikLapan] || '') : '',
      };
    }
  }
  return null;
}

function appendKeputusanRow_(values) {
  const sh = getSheet_(SHEET_KEPUTUSAN);
  const header = sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0]
    .map(function (h) {
      return String(h).toLowerCase().trim();
    });
  const cDaerah = header.indexOf('daerah');
  if (cDaerah >= 0) {
    sh.appendRow([
      values.attemptId,
      values.masaHantar,
      values.ic,
      values.nama,
      values.daerah,
      values.betul,
      values.jumlah,
      values.skor,
      values.jawapanJson,
      values.butiranJson,
    ]);
  } else {
    sh.appendRow([
      values.attemptId,
      values.masaHantar,
      values.ic,
      values.nama,
      values.betul,
      values.jumlah,
      values.skor,
      values.jawapanJson,
      values.butiranJson,
    ]);
  }
}

function submitExam(ic, attemptId, jawapan) {
  const icNorm = normalizeIc_(ic);
  if (!icNorm) {
    return { ok: false, ralat: 'IC diperlukan.' };
  }
  if (!attemptId) {
    return { ok: false, ralat: 'attempt_id diperlukan.' };
  }

  const attempt = getAttemptRow_(attemptId, icNorm);
  if (!attempt || attempt.error) {
    return {
      ok: false,
      ralat: attempt ? attempt.error : 'Percubaan tidak dijumpai.',
    };
  }
  if (attempt.status === STATUS_SELESAI) {
    return {
      ok: false,
      ralat: 'Jawapan telah dihantar sebelum ini.',
      sudah_hantar: true,
      mesej_terima_kasih: MSJ_TERIMA_KASIH,
    };
  }

  const timing = buildTimingInfo_(attempt.masa_mula);
  if (Date.now() > timing.batas_masa_ms) {
    return {
      ok: false,
      ralat: 'Masa kuiz 1 jam telah tamat. Sila hubungi pengawas.',
    };
  }

  const bank = loadQuestionBank_();
  const questions = buildQuestionsFromIds_(bank, attempt.soalan_ids);
  const jawapanMap = jawapan || {};
  const graded = gradeAnswers_(questions, jawapanMap);

  const shPercubaan = getSheet_(SHEET_PERCUBAAN);
  const header = getPercubaanHeaders_();
  const cStatus = header.indexOf('status');
  shPercubaan.getRange(attempt.row, cStatus + 1).setValue(STATUS_SELESAI);

  appendKeputusanRow_({
    attemptId: attempt.attempt_id,
    masaHantar: new Date(),
    ic: icNorm,
    nama: attempt.nama,
    daerah: attempt.daerah,
    betul: graded.betul,
    jumlah: graded.jumlah,
    skor: graded.skor,
    jawapanJson: JSON.stringify(jawapanMap),
    butiranJson: JSON.stringify(graded.butiran),
  });

  return {
    ok: true,
    mesej_terima_kasih: MSJ_TERIMA_KASIH,
  };
}

function getResult(ic, daerah) {
  const icNorm = normalizeIc_(ic);
  const daerahNorm = normalizeDaerah_(daerah);
  if (!icNorm) {
    return { ok: false, ralat: 'IC diperlukan.' };
  }

  if (findFinishedAttempt_(icNorm, daerahNorm)) {
    return {
      ok: true,
      sudah_hantar: true,
      mesej_terima_kasih: MSJ_TERIMA_KASIH,
    };
  }

  return { ok: false, ralat: 'Tiada rekod peperiksaan.' };
}

function findKeputusanByIc_(icNorm, daerahFilter) {
  const sh = getSheet_(SHEET_KEPUTUSAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;

  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cIc = header.indexOf('ic');
  const cNama = header.indexOf('nama');
  const cDaerah = header.indexOf('daerah');
  const cBetul = header.indexOf('betul');
  const cJumlah = header.indexOf('jumlah');
  const cSkor = header.indexOf('skor');
  const cMasa = header.indexOf('masa_hantar');
  const cJawapan = header.indexOf('jawapan_json');
  const cButiran = header.indexOf('butiran_json');
  const filterNorm = normalizeDaerah_(daerahFilter);

  for (let r = data.length - 1; r >= 1; r--) {
    if (normalizeIc_(data[r][cIc]) !== icNorm) continue;
    const rowDaerah = cDaerah >= 0 ? normalizeDaerah_(data[r][cDaerah]) : '';
    if (filterNorm && rowDaerah && rowDaerah !== filterNorm) continue;
    return {
      attempt_id: String(data[r][cAttempt]),
      masa_hantar: cMasa >= 0 ? data[r][cMasa] : '',
      nama: String(data[r][cNama]),
      daerah: rowDaerah,
      betul: Number(data[r][cBetul]),
      jumlah: Number(data[r][cJumlah]),
      skor: Number(data[r][cSkor]),
      jawapan_json: data[r][cJawapan],
      butiran_json: cButiran >= 0 ? data[r][cButiran] : '',
      row: r,
    };
  }
  return null;
}

function toTimeMs_(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

function formatMasaHantar_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      'dd/MM/yyyy HH:mm:ss'
    );
  }
  return String(value || '');
}

function formatMasaFromMs_(ms) {
  return Utilities.formatDate(
    new Date(ms),
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm:ss'
  );
}

function formatTempohMs_(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  if (h > 0) {
    return pad(h) + ' jam ' + pad(m) + ' min ' + pad(s) + ' saat';
  }
  if (m > 0) {
    return m + ' min ' + pad(s) + ' saat';
  }
  return s + ' saat';
}

function buildTimingInfo_(masaMula) {
  const startMs = toTimeMs_(masaMula);
  const endMs = startMs + TEMPOH_KUIZ_MS;
  return {
    masa_mula_ms: startMs,
    batas_masa_ms: endMs,
    masa_mula_label: formatMasaHantar_(masaMula),
    batas_masa_label: formatMasaFromMs_(endMs),
    tempoh_kuiz_minit: Math.round(TEMPOH_KUIZ_MS / 60000),
  };
}

function getAttemptMasaMulaMap_() {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return {};

  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cMula = header.indexOf('masa_mula');
  const map = {};

  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][cAttempt] || '').trim();
    if (!id) continue;
    map[id] = cMula >= 0 ? data[r][cMula] : '';
  }
  return map;
}

function enrichRowWithTempoh_(row, masaMulaMap) {
  const masaMula = masaMulaMap[row.attempt_id];
  const startMs = toTimeMs_(masaMula);
  const endMs = toTimeMs_(row.masa_hantar);
  const tempohMs =
    startMs <= endMs && startMs < Number.MAX_SAFE_INTEGER
      ? endMs - startMs
      : Number.MAX_SAFE_INTEGER;
  return {
    tempoh_ms: tempohMs,
    tempoh_label: formatTempohMs_(tempohMs),
    masa_mula_label: formatMasaHantar_(masaMula),
  };
}

function isBetterKeputusan_(a, b) {
  if (a.skor > b.skor) return true;
  if (a.skor < b.skor) return false;
  return a.tempoh_ms < b.tempoh_ms;
}

function loadAllKeputusanRows_(daerahFilter) {
  const sh = getSheet_(SHEET_KEPUTUSAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const cAttempt = header.indexOf('attempt_id');
  const cMasa = header.indexOf('masa_hantar');
  const cIc = header.indexOf('ic');
  const cNama = header.indexOf('nama');
  const cDaerah = header.indexOf('daerah');
  const cBetul = header.indexOf('betul');
  const cJumlah = header.indexOf('jumlah');
  const cSkor = header.indexOf('skor');
  const filterNorm = normalizeDaerah_(daerahFilter);

  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const ic = normalizeIc_(data[r][cIc]);
    if (!ic) continue;
    const rowDaerah = cDaerah >= 0 ? normalizeDaerah_(data[r][cDaerah]) : '';
    if (filterNorm && rowDaerah && rowDaerah !== filterNorm) continue;
    if (filterNorm && !rowDaerah) continue;
    rows.push({
      attempt_id: String(data[r][cAttempt]),
      masa_hantar: data[r][cMasa],
      ic: ic,
      nama: String(data[r][cNama]),
      daerah: rowDaerah,
      betul: Number(data[r][cBetul]),
      jumlah: Number(data[r][cJumlah]),
      skor: Number(data[r][cSkor]),
    });
  }
  return rows;
}

function buildRanking_(daerahFilter, includeDaerah) {
  const rows = loadAllKeputusanRows_(daerahFilter);
  const masaMulaMap = getAttemptMasaMulaMap_();
  const daerahNamaMap = loadDaerahNamaMap_();
  const byKey = {};

  rows.forEach(function (row) {
    const enriched = Object.assign(
      row,
      enrichRowWithTempoh_(row, masaMulaMap)
    );
    const key = row.ic + '|' + (row.daerah || '');
    const existing = byKey[key];
    if (!existing || isBetterKeputusan_(enriched, existing)) {
      byKey[key] = enriched;
    }
  });

  const list = Object.keys(byKey).map(function (key) {
    return byKey[key];
  });

  list.sort(function (a, b) {
    if (b.skor !== a.skor) return b.skor - a.skor;
    return a.tempoh_ms - b.tempoh_ms;
  });

  return list.map(function (row, index) {
    const out = {
      kedudukan: index + 1,
      ic: row.ic,
      nama: row.nama,
      betul: row.betul,
      jumlah: row.jumlah,
      skor: row.skor,
      tempoh_label: row.tempoh_label,
      tempoh_ms: row.tempoh_ms,
      masa_mula_label: row.masa_mula_label,
    };
    if (includeDaerah) {
      out.daerah = row.daerah || '';
      out.nama_daerah = daerahNamaMap[row.daerah] || row.daerah || '-';
    }
    return out;
  });
}

function adminRanking(pin) {
  const pinCheck = verifyAdminPin_(pin);
  if (!pinCheck.ok) return pinCheck;

  const isNegeri = pinCheck.peranan === PERANAN_NEGERI;
  const filterDaerah = isNegeri ? null : pinCheck.kod_daerah;
  const ranking = buildRanking_(filterDaerah, isNegeri);

  return {
    ok: true,
    mod: 'ranking',
    peranan: pinCheck.peranan,
    kod_daerah: pinCheck.kod_daerah,
    nama_daerah: pinCheck.nama_daerah,
    ranking: ranking,
    jumlah_peserta: ranking.length,
    papar_daerah: isNegeri,
  };
}

function adminReview(pin, ic) {
  const pinCheck = verifyAdminPin_(pin);
  if (!pinCheck.ok) return pinCheck;

  const icNorm = normalizeIc_(ic);
  if (!icNorm) {
    return adminRanking(pin);
  }

  const daerahFilter =
    pinCheck.peranan === PERANAN_NEGERI ? null : pinCheck.kod_daerah;
  const row = findKeputusanByIc_(icNorm, daerahFilter);
  if (!row) {
    return { ok: false, ralat: 'Tiada rekod peperiksaan untuk IC ini.' };
  }

  let butiran = [];
  if (row.butiran_json) {
    try {
      butiran = JSON.parse(row.butiran_json);
    } catch (e) {
      butiran = [];
    }
  }

  if (!butiran.length) {
    const bank = loadQuestionBank_();
    const attempt = getAttemptRow_(row.attempt_id, icNorm);
    if (attempt && !attempt.error) {
      const questions = buildQuestionsFromIds_(bank, attempt.soalan_ids);
      let jawapanMap = {};
      try {
        jawapanMap = JSON.parse(row.jawapan_json || '{}');
      } catch (e2) {
        jawapanMap = {};
      }
      butiran = gradeAnswers_(questions, jawapanMap).butiran;
    }
  }

  const attempt = getAttemptRow_(row.attempt_id, icNorm);
  const topik_lapan = attempt && !attempt.error ? attempt.topik_lapan : '';
  const masaMulaMap = getAttemptMasaMulaMap_();
  const tempohInfo = enrichRowWithTempoh_(
    {
      attempt_id: row.attempt_id,
      masa_hantar: row.masa_hantar,
    },
    masaMulaMap
  );

  return {
    ok: true,
    mod: 'individu',
    peranan: pinCheck.peranan,
    ic: icNorm,
    nama: row.nama,
    daerah: row.daerah,
    attempt_id: row.attempt_id,
    betul: row.betul,
    jumlah: row.jumlah,
    salah: row.jumlah - row.betul,
    skor: row.skor,
    masa_mula_label: tempohInfo.masa_mula_label,
    masa_hantar: formatMasaHantar_(row.masa_hantar),
    tempoh_label: tempohInfo.tempoh_label,
    topik_lapan: topik_lapan,
    butiran: butiran,
  };
}
