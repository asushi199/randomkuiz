/**
 * Isi data ujian Saringan 2 untuk ahli pasukan layak S2 (kecuali yang sudah ada rekod).
 * Guna: node --env-file=web/.env.local scripts/seed_s2_testdata.mjs
 * (dari akar repo; baca SUPABASE_* daripada web/.env.local)
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createClient } = createRequire(resolve(ROOT, "web/package.json"))("@supabase/supabase-js");
const TOPIK_LIST = ["AKIDAH", "ALQURAN", "JAWI", "SIRAH", "HADIS", "IBADAH", "ADAB"];
const JUMLAH = 50;
const LETTERS = ["A", "B", "C", "D"];

function loadEnv() {
  const raw = readFileSync(resolve(ROOT, "web/.env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromIc(ic) {
  let h = 2166136261;
  for (const c of String(ic)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function sample(pool, n, rng, label) {
  if (pool.length < n) throw new Error("Soalan tidak cukup untuk " + label);
  return shuffle(pool, rng).slice(0, n);
}

function buildKertas(bank, exclude, rng) {
  const topikLapan = shuffle(TOPIK_LIST, rng)[0];
  let ids = [];
  for (const topik of TOPIK_LIST) {
    const nTing = topik === topikLapan ? 4 : 3;
    const sed = [], ting = [];
    for (const id of Object.keys(bank)) {
      if (exclude[id]) continue;
      const q = bank[id];
      if (q.topik !== topik) continue;
      if (q.aras === "sederhana") sed.push(id);
      else if (q.aras === "tinggi") ting.push(id);
    }
    ids = ids.concat(
      sample(sed, 4, rng, topik + " sederhana"),
      sample(ting, nTing, rng, topik + " tinggi")
    );
  }
  if (ids.length !== JUMLAH) throw new Error("Cabutan gagal: " + ids.length);
  return { ids: shuffle(ids, rng), topik_lapan: topikLapan };
}

function pickBetul(ic, rng) {
  const n = 22 + Math.floor(rng() * 25); // 22..46 / 50
  return Math.min(46, Math.max(18, n));
}

function gradePaper(bank, ids, betulTarget, rng) {
  const idx = shuffle(ids.map((_, i) => i), rng);
  const correctAt = new Set(idx.slice(0, betulTarget));
  const jawapan = {};
  const butiran = ids.map((id, i) => {
    const q = bank[id];
    const ok = correctAt.has(i);
    let pel = q.jawapan;
    if (!ok) {
      const wrong = LETTERS.filter((L) => L !== q.jawapan);
      pel = wrong[Math.floor(rng() * wrong.length)];
    }
    jawapan[id] = pel;
    return {
      id, topik: q.topik || "", aras: q.aras || "", nombor: i + 1, soalan: q.soalan,
      jawapan_pelajar: pel, jawapan_betul: q.jawapan, betul: ok,
    };
  });
  const betul = butiran.filter((b) => b.betul).length;
  return { jawapan, butiran, betul, jumlah: ids.length, skor: Math.round((betul / ids.length) * 100), mata: betul };
}

async function main() {
  const env = loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: kel, error: eKel } = await db.from("kelayakan").select("daerah").eq("peringkat", "S2");
  if (eKel) throw eKel;
  const teams = (kel || []).map((r) => r.daerah);
  if (!teams.length) throw new Error("Tiada pasukan layak S2. Kunci kelayakan dahulu.");

  const { data: bankRows, error: eBank } = await db.from("soalan").select("id,topik,aras,soalan,jawapan");
  if (eBank) throw eBank;
  const bank = {};
  (bankRows || []).forEach((q) => {
    bank[q.id] = { id: q.id, topik: String(q.topik || "").toUpperCase(), aras: String(q.aras || "").toLowerCase(), soalan: q.soalan, jawapan: String(q.jawapan || "").toUpperCase() };
  });

  const { data: s1, error: e1 } = await db.from("percubaan")
    .select("ic,nama,daerah,soalan_ids,skor")
    .eq("peringkat", "S1").eq("status", "selesai").in("daerah", teams);
  if (e1) throw e1;

  const { data: s2exist, error: e2 } = await db.from("percubaan").select("ic").eq("peringkat", "S2");
  if (e2) throw e2;
  const haveS2 = new Set((s2exist || []).map((r) => r.ic));

  const byD = {};
  (s1 || []).forEach((r) => { (byD[r.daerah] = byD[r.daerah] || []).push(r); });
  Object.keys(byD).forEach((d) => {
    byD[d].sort((a, b) => Number(b.skor) - Number(a.skor));
  });

  const targets = [];
  for (const d of teams) {
    (byD[d] || []).slice(0, 3).forEach((p) => {
      if (!haveS2.has(p.ic)) targets.push(p);
    });
  }
  if (!targets.length) {
    console.log("Tiada peserta baharu: semua ahli pasukan layak sudah ada rekod S2.");
    return;
  }

  const now = Date.now();
  let ok = 0;
  for (const p of targets) {
    const rng = mulberry32(seedFromIc(p.ic));
    const exclude = {};
    (p.soalan_ids || []).forEach((id) => { exclude[String(id).trim()] = true; });
    const kertas = buildKertas(bank, exclude, rng);
    const graded = gradePaper(bank, kertas.ids, pickBetul(p.ic, rng), rng);
    const tempohMin = 12 + Math.floor(rng() * 28);
    const masaMula = new Date(now - (targets.indexOf(p) + 2) * 7 * 60 * 1000);
    const masaHantar = new Date(masaMula.getTime() + tempohMin * 60 * 1000 + Math.floor(rng() * 40) * 1000);
    const { error } = await db.from("percubaan").insert({
      peringkat: "S2",
      ic: p.ic,
      nama: p.nama,
      daerah: p.daerah,
      soalan_ids: kertas.ids,
      topik_lapan: kertas.topik_lapan,
      status: "selesai",
      masa_mula: masaMula.toISOString(),
      masa_hantar: masaHantar.toISOString(),
      betul: graded.betul,
      jumlah: graded.jumlah,
      skor: graded.skor,
      mata: graded.mata,
      jawapan: graded.jawapan,
      butiran: graded.butiran,
    });
    if (error) throw error;
    ok++;
    console.log("S2", p.daerah, p.nama, graded.betul + "/" + graded.jumlah, graded.skor + "%");
  }
  console.log("Selesai:", ok, "rekod S2 baharu. Dilepaskan (sudah ada):", haveS2.size);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
