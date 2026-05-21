/**
 * Peperiksaan dalam talian — Google Apps Script backend
 * Set SPREADSHEET_ID in Project Settings > Script properties
 */

const JUMLAH_SOALAN = 50;
const SHEET_SOALAN = 'Soalan';
const SHEET_PERCUBAAN = 'Percubaan';
const SHEET_KEPUTUSAN = 'Keputusan';
const STATUS_SEDANG = 'sedang';
const STATUS_SELESAI = 'selesai';

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
      case 'startExam':
        return jsonResponse(startExam(payload.ic, payload.nama));
      case 'submitExam':
        return jsonResponse(
          submitExam(payload.ic, payload.attempt_id, payload.jawapan)
        );
      case 'getResult':
        return jsonResponse(getResult(payload.ic));
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
    sh.appendRow(['id', 'soalan', 'A', 'B', 'C', 'D', 'jawapan']);
  } else if (name === SHEET_PERCUBAAN) {
    sh.appendRow([
      'attempt_id',
      'masa_mula',
      'ic',
      'nama',
      'soalan_ids',
      'status',
    ]);
  } else if (name === SHEET_KEPUTUSAN) {
    sh.appendRow([
      'attempt_id',
      'masa_hantar',
      'ic',
      'nama',
      'betul',
      'jumlah',
      'skor',
      'jawapan_json',
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

function loadQuestionBank_() {
  const sh = getSheet_(SHEET_SOALAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error('Bank soalan kosong. Import data/questions.csv ke Sheet Soalan.');
  }
  const header = data[0].map(function (h) {
    return String(h).toLowerCase().trim();
  });
  const idx = {
    id: header.indexOf('id'),
    soalan: header.indexOf('soalan'),
    a: header.indexOf('a'),
    b: header.indexOf('b'),
    c: header.indexOf('c'),
    d: header.indexOf('d'),
    jawapan: header.indexOf('jawapan'),
  };
  const bank = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row[idx.id]) continue;
    const id = String(row[idx.id]).trim();
    bank[id] = {
      id: id,
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

function sampleIds_(bank, n) {
  const ids = Object.keys(bank);
  if (ids.length < n) {
    throw new Error(
      'Bank soalan hanya ' + ids.length + ' soalan; perlukan ' + n + '.'
    );
  }
  return shuffle_(ids).slice(0, n);
}

function findActiveAttempt_(ic) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (
      normalizeIc_(data[r][2]) === ic &&
      data[r][5] === STATUS_SEDANG
    ) {
      return {
        row: r + 1,
        attempt_id: String(data[r][0]),
        soalan_ids: String(data[r][4])
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
        nama: String(data[r][3]),
      };
    }
  }
  return null;
}

function findFinishedAttempt_(ic) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (
      normalizeIc_(data[r][2]) === ic &&
      data[r][5] === STATUS_SELESAI
    ) {
      return { attempt_id: String(data[r][0]) };
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

function newAttemptId_() {
  return (
    'ATT-' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') +
    '-' +
    Math.floor(Math.random() * 10000)
  );
}

function startExam(ic, nama) {
  const icNorm = normalizeIc_(ic);
  const namaNorm = normalizeNama_(nama);
  if (!icNorm || icNorm.length < 6) {
    return { ok: false, ralat: 'No. Kad Pengenalan tidak sah.' };
  }
  if (!namaNorm) {
    return { ok: false, ralat: 'Nama penuh diperlukan.' };
  }

  const bank = loadQuestionBank_();
  const finished = findFinishedAttempt_(icNorm);
  if (finished) {
    const last = getResult(icNorm);
    if (last.ok) {
      return {
        ok: false,
        ralat: 'Anda telah menghantar peperiksaan ini.',
        sudah_hantar: true,
        keputusan: last,
      };
    }
    return {
      ok: false,
      ralat: 'Anda telah menghantar peperiksaan ini.',
      sudah_hantar: true,
    };
  }

  let active = findActiveAttempt_(icNorm);
  if (active) {
    const questions = buildQuestionsFromIds_(bank, active.soalan_ids);
    return {
      ok: true,
      attempt_id: active.attempt_id,
      nama: active.nama || namaNorm,
      soalan: stripAnswers_(questions),
      jumlah: questions.length,
      sambungan: true,
    };
  }

  const ids = sampleIds_(bank, JUMLAH_SOALAN);
  const attemptId = newAttemptId_();
  const sh = getSheet_(SHEET_PERCUBAAN);
  sh.appendRow([
    attemptId,
    new Date(),
    icNorm,
    namaNorm,
    ids.join(','),
    STATUS_SEDANG,
  ]);

  const questions = buildQuestionsFromIds_(bank, ids);
  return {
    ok: true,
    attempt_id: attemptId,
    nama: namaNorm,
    soalan: stripAnswers_(questions),
    jumlah: questions.length,
    sambungan: false,
  };
}

function getAttemptRow_(attemptId, ic) {
  const sh = getSheet_(SHEET_PERCUBAAN);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(attemptId)) {
      if (normalizeIc_(data[r][2]) !== ic) {
        return { error: 'Percubaan tidak sepadan dengan IC.' };
      }
      return {
        row: r + 1,
        attempt_id: String(data[r][0]),
        ic: normalizeIc_(data[r][2]),
        nama: String(data[r][3]),
        soalan_ids: String(data[r][4])
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
        status: String(data[r][5]),
      };
    }
  }
  return null;
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
    return { ok: false, ralat: attempt ? attempt.error : 'Percubaan tidak dijumpai.' };
  }
  if (attempt.status === STATUS_SELESAI) {
    return { ok: false, ralat: 'Jawapan telah dihantar sebelum ini.' };
  }

  const bank = loadQuestionBank_();
  const questions = buildQuestionsFromIds_(bank, attempt.soalan_ids);
  const jawapanMap = jawapan || {};
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
      nombor: i + 1,
      soalan: q.soalan,
      jawapan_pelajar: student || '-',
      jawapan_betul: q.jawapan,
      betul: isCorrect,
    });
  });

  const jumlah = questions.length;
  const skor = jumlah ? Math.round((betul / jumlah) * 100) : 0;

  const shPercubaan = getSheet_(SHEET_PERCUBAAN);
  shPercubaan.getRange(attempt.row, 6).setValue(STATUS_SELESAI);

  const shKeputusan = getSheet_(SHEET_KEPUTUSAN);
  shKeputusan.appendRow([
    attempt.attempt_id,
    new Date(),
    icNorm,
    attempt.nama,
    betul,
    jumlah,
    skor,
    JSON.stringify(jawapanMap),
  ]);

  return {
    ok: true,
    attempt_id: attempt.attempt_id,
    nama: attempt.nama,
    betul: betul,
    jumlah: jumlah,
    salah: jumlah - betul,
    skor: skor,
    butiran: butiran,
  };
}

function getResult(ic) {
  const icNorm = normalizeIc_(ic);
  if (!icNorm) {
    return { ok: false, ralat: 'IC diperlukan.' };
  }

  const sh = getSheet_(SHEET_KEPUTUSAN);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    return { ok: false, ralat: 'Tiada keputusan dijumpai.' };
  }

  for (let r = data.length - 1; r >= 1; r--) {
    if (normalizeIc_(data[r][2]) === icNorm) {
      const bank = loadQuestionBank_();
      const attempt = getAttemptRow_(data[r][0], icNorm);
      let butiran = [];
      if (attempt && !attempt.error) {
        const questions = buildQuestionsFromIds_(bank, attempt.soalan_ids);
        let jawapanMap = {};
        try {
          jawapanMap = JSON.parse(data[r][7] || '{}');
        } catch (e) {
          jawapanMap = {};
        }
        questions.forEach(function (q, i) {
          const student = String(jawapanMap[q.id] || '')
            .trim()
            .toUpperCase();
          butiran.push({
            id: q.id,
            nombor: i + 1,
            soalan: q.soalan,
            jawapan_pelajar: student || '-',
            jawapan_betul: q.jawapan,
            betul: student === q.jawapan,
          });
        });
      }

      return {
        ok: true,
        attempt_id: String(data[r][0]),
        nama: String(data[r][3]),
        betul: Number(data[r][4]),
        jumlah: Number(data[r][5]),
        skor: Number(data[r][6]),
        salah: Number(data[r][5]) - Number(data[r][4]),
        butiran: butiran,
      };
    }
  }

  return { ok: false, ralat: 'Tiada keputusan dijumpai.' };
}
