/**
 * Kira semula markah (regrade) berdasarkan KANDUNGAN pilihan, bukan huruf.
 *
 * Masalah: sesetengah soalan JAWI ada pilihan yang teks-nya SAMA (atau nampak
 * sama — cuma beza bentuk huruf kaf ك/ک), tetapi hanya SATU huruf ditetapkan
 * betul. Peserta yang pilih pilihan "kembar" itu tersalah dikira salah.
 *
 * Penyelesaian: satu jawapan dikira betul jika teks pilihan yang dipilih
 * peserta SAMA dengan teks pilihan jawapan rasmi (selepas menyamakan huruf
 * Jawi yang seiras). Ini membaiki semua kes secara automatik, termasuk yang
 * belum dijumpai, dan LANGSUNG tidak menjejaskan soalan Rumi (Bahasa Melayu).
 *
 * Jawapan mentah setiap peserta (huruf yang dipilih per soalan) tersimpan dalam
 * lajur `percubaan.jawapan`, jadi peserta yang SUDAH hantar pun boleh dikira
 * semula dengan tepat — tiada data hilang.
 *
 * Guna (dari akar repo):
 *   node --env-file=web/.env.local scripts/regrade_content.mjs           # TRY / dry-run sahaja (tidak ubah DB)
 *   node --env-file=web/.env.local scripts/regrade_content.mjs --apply   # tulis ke DB (buat backup dahulu)
 *
 * Backup ditulis ke scripts/backup/percubaan-<timestamp>.json sebelum apa-apa
 * kemas kini. Untuk memulihkan, muat naik semula nilai lama dari fail itu.
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createClient } = createRequire(resolve(ROOT, "web/package.json"))("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const S3P1_MATA = 2; // selaras dengan web/src/lib/kuiz.ts

// ---- Normalisasi ----
const normHuruf = (v) => String(v ?? "").trim().toUpperCase();

// Samakan huruf Jawi yang seiras (nampak sama di skrin) supaya teks yang
// sepadan dikira sama. Hanya menyentuh aksara Arab — teks Rumi tidak berubah.
function normText(s) {
  return String(s ?? "")
    .replace(/[‌‍ـ]/g, "") // ZWNJ, ZWJ, tatweel
    .replace(/ک/g, "ك") // ک (keheh) -> ك (kaf)
    .replace(/ڪ/g, "ك") // ػ (swash kaf) -> ك
    .replace(/ی/g, "ي") // ی (farsi yeh) -> ي
    .replace(/ى/g, "ي") // ى (alef maksura) -> ي
    .replace(/ھ/g, "ه") // ھ (heh doachashmee) -> ه
    .replace(/\s+/g, " ")
    .trim();
}

function loadEnv() {
  // Nilai sebenar dibaca oleh --env-file=; fungsi ini cuma pengesahan mesra.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // fallback: cuba baca web/.env.local sendiri jika --env-file tidak diguna
    try {
      const raw = readFileSync(resolve(ROOT, "web/.env.local"), "utf8");
      const env = {};
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const i = line.indexOf("=");
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
    } catch {
      throw new Error("SUPABASE env tidak dijumpai. Guna: node --env-file=web/.env.local scripts/regrade_content.mjs");
    }
  }
  return { url, key };
}

function bankFromRows(rows, idKey) {
  const bank = {};
  (rows || []).forEach((r) => {
    const id = String(r[idKey]).trim();
    bank[id] = {
      id,
      topik: String(r.topik || "").toUpperCase().trim(),
      aras: String(r.aras || "").toLowerCase().trim(),
      soalan: String(r.soalan || ""),
      A: String(r.a || ""), B: String(r.b || ""), C: String(r.c || ""), D: String(r.d || ""),
      jawapan: normHuruf(r.jawapan),
    };
  });
  return bank;
}

// Kira satu kertas guna perbandingan KANDUNGAN.
function gradeContent(qs, jawapanMap) {
  let betul = 0;
  const butiran = qs.map((q, i) => {
    const pel = normHuruf(jawapanMap ? jawapanMap[q.id] : "");
    const chosen = pel && q[pel] !== undefined ? q[pel] : null;
    const ok = chosen != null && normText(chosen) === normText(q[q.jawapan]);
    if (ok) betul++;
    return {
      id: q.id, topik: q.topik || "", aras: q.aras || "", nombor: i + 1, soalan: q.soalan,
      jawapan_pelajar: pel || "-", jawapan_betul: q.jawapan, betul: ok,
    };
  });
  const jumlah = qs.length;
  return { betul, jumlah, skor: jumlah ? Math.round((betul / jumlah) * 100) : 0, butiran };
}

// Laporan: soalan yang ada pilihan kembar (teks sama selepas normalisasi).
function reportBank(name, bank) {
  const hits = [];
  for (const q of Object.values(bank)) {
    const g = {};
    for (const L of ["A", "B", "C", "D"]) {
      const nv = normText(q[L]);
      (g[nv] = g[nv] || []).push(L);
    }
    const dups = Object.entries(g).filter(([, ks]) => ks.length > 1);
    if (dups.length) {
      for (const [nv, ks] of dups) {
        const correctIn = ks.includes(q.jawapan);
        hits.push({ id: q.id, soalan: q.soalan, letters: ks, teks: nv, jawapan: q.jawapan, correctIn });
      }
    }
  }
  if (!hits.length) { console.log(`  [${name}] tiada pilihan kembar.`); return; }
  console.log(`  [${name}] ${hits.length} kumpulan pilihan kembar:`);
  for (const h of hits) {
    const tag = h.correctIn ? "<-- termasuk jawapan betul (peserta boleh terjejas)" : "(bukan jawapan rasmi — tiada peserta terjejas)";
    console.log(`    ${h.id} jawapan=${h.jawapan} | pilihan ${h.letters.join("=")} sama  ${tag}  | ${h.soalan}`);
  }
}

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Muat bank soalan
  const { data: bankRows, error: eBank } = await db.from("soalan").select("*");
  if (eBank) throw eBank;
  const bank = bankFromRows(bankRows, "id");

  let bankS3P1 = {};
  const { data: s3Rows, error: eS3 } = await db.from("soalan_s3p1").select("*");
  if (!eS3 && s3Rows) bankS3P1 = bankFromRows(s3Rows, "no");

  console.log("=== Imbasan bank soalan (pilihan kembar) ===");
  reportBank("soalan", bank);
  reportBank("soalan_s3p1", bankS3P1);

  // 2) Muat semua percubaan yang sudah 'selesai'
  const { data: attempts, error: eA } = await db.from("percubaan")
    .select("id,peringkat,ic,nama,daerah,status,soalan_ids,jawapan,betul,jumlah,skor,mata,butiran")
    .eq("status", "selesai");
  if (eA) throw eA;

  console.log(`\n=== Kira semula ${attempts.length} percubaan (status=selesai) ===`);

  const changes = [];
  for (const a of attempts) {
    const useBank = a.peringkat === "S3P1" ? bankS3P1 : bank;
    const ids = (a.soalan_ids || []).map((x) => String(x).trim());
    const miss = ids.filter((id) => !useBank[id]);
    if (miss.length) {
      console.log(`  ! ${a.peringkat} ${a.ic} ${a.nama}: soalan hilang dari bank (${miss.slice(0, 3).join(",")}...) — DILANGKAU`);
      continue;
    }
    const qs = ids.map((id) => useBank[id]);
    const g = gradeContent(qs, a.jawapan || {});
    const mata = a.peringkat === "S3P1" ? g.betul * S3P1_MATA : g.betul;
    if (g.betul !== Number(a.betul) || g.skor !== Number(a.skor) || mata !== Number(a.mata || 0)) {
      changes.push({
        id: a.id, peringkat: a.peringkat, ic: a.ic, nama: a.nama, daerah: a.daerah,
        lama: { betul: a.betul, skor: a.skor, mata: a.mata },
        baru: { betul: g.betul, jumlah: g.jumlah, skor: g.skor, mata, butiran: g.butiran },
      });
    }
  }

  if (!changes.length) {
    console.log("\nTiada perubahan markah. Semua percubaan sudah adil. Tiada apa perlu ditulis.");
    return;
  }

  console.log(`\n${changes.length} percubaan akan berubah:`);
  for (const c of changes) {
    console.log(`  ${c.peringkat} ${c.daerah} ${c.nama} (${c.ic}): betul ${c.lama.betul}->${c.baru.betul}, skor ${c.lama.skor}%->${c.baru.skor}%, mata ${c.lama.mata}->${c.baru.mata}`);
  }

  if (!APPLY) {
    console.log("\n[TRY sahaja] DB TIDAK diubah. Untuk tulis, jalankan semula dengan --apply.");
    return;
  }

  // 3) Backup sebelum tulis
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(ROOT, "scripts/backup");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `percubaan-${stamp}.json`);
  const backupRows = attempts.filter((a) => changes.some((c) => c.id === a.id))
    .map((a) => ({ id: a.id, betul: a.betul, jumlah: a.jumlah, skor: a.skor, mata: a.mata, butiran: a.butiran }));
  writeFileSync(backupPath, JSON.stringify(backupRows, null, 2), "utf8");
  console.log(`\nBackup ${backupRows.length} baris lama -> ${backupPath}`);

  // 4) Tulis kemas kini
  let ok = 0;
  for (const c of changes) {
    const { error } = await db.from("percubaan")
      .update({ betul: c.baru.betul, jumlah: c.baru.jumlah, skor: c.baru.skor, mata: c.baru.mata, butiran: c.baru.butiran })
      .eq("id", c.id);
    if (error) { console.log(`  ! gagal ${c.ic}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`\nSelesai: ${ok}/${changes.length} percubaan dikemas kini.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
