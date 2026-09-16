import { db, getAdminPin } from "./supabase";

// ================= Pemalar =================
export const JUMLAH_SOALAN = 50;
const TOPIK_LIST = ["AKIDAH", "ALQURAN", "JAWI", "SIRAH", "HADIS", "IBADAH", "ADAB"];
const TEMPOH_KUIZ_MS = 60 * 60 * 1000;
const S3P1_SET_COUNT = 4;
const S3P1_SOALAN = 10;
const S3P1_SAAT = 20;
const S3P1_MATA = 2;
const REBUTAN_PILIH = 8;
const PERINGKAT_PELAJAR = ["S1", "S3P1"];
export const PERINGKAT_LABEL: Record<string, string> = {
  S1: "Saringan 1", S2: "Saringan 2", S3P1: "Saringan 2 — Pusingan 1",
  S3P2: "Saringan 2 — Pusingan 2", S3P3: "Saringan 2 — Pusingan 3",
  TUTUP: "Ditutup",
};
const MSJ_TERIMA_KASIH =
  "Terima kasih. Jawapan anda telah direkodkan. Keputusan akan diumumkan oleh pihak pengurusan.";

type Json = Record<string, unknown>;

// ================= Normalisasi =================
const normIc = (v: unknown) => String(v ?? "").replace(/[\s-]/g, "").trim();
const normNama = (v: unknown) => String(v ?? "").trim();
const normDaerah = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, "_");
const normPin = (v: unknown) => String(v ?? "").trim();
const normHuruf = (v: unknown) => String(v ?? "").trim().toUpperCase();

// ================= Tetapan =================
async function getTetapan(kunci: string, fallback = ""): Promise<string> {
  const { data } = await db.from("tetapan").select("nilai").eq("kunci", kunci).maybeSingle();
  return data?.nilai != null ? String(data.nilai) : fallback;
}
async function setTetapan(kunci: string, nilai: string) {
  await db.from("tetapan").upsert({ kunci, nilai }, { onConflict: "kunci" });
}
async function getPeringkatAktif(): Promise<string> {
  return (await getTetapan("peringkat_aktif", "TUTUP")).toUpperCase();
}

// ================= Daerah / Kelayakan =================
type Daerah = { kod: string; nama: string };
async function getDaerahList(): Promise<Daerah[]> {
  const { data } = await db.from("daerah").select("kod,nama,urutan").order("urutan");
  return (data || []).map((d) => ({ kod: normDaerah(d.kod), nama: String(d.nama || d.kod) }));
}
async function daerahNamaMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  (await getDaerahList()).forEach((d) => { map[d.kod] = d.nama; });
  return map;
}
async function isValidDaerah(kod: string): Promise<boolean> {
  const list = await getDaerahList();
  return !list.length || list.some((d) => d.kod === kod);
}
async function getKelayakan(peringkat: string): Promise<Record<string, boolean>> {
  const { data } = await db.from("kelayakan").select("daerah").eq("peringkat", peringkat);
  const set: Record<string, boolean> = {};
  (data || []).forEach((r) => { set[normDaerah(r.daerah)] = true; });
  return set;
}
async function isLayak(peringkat: string, daerah: string): Promise<boolean> {
  if (peringkat === "S1") return true;
  const set = await getKelayakan(peringkat);
  return Object.keys(set).length ? !!set[daerah] : false;
}

// ================= Bank soalan (cache dalam-instance) =================
type Soalan = { id: string; topik: string; aras: string; soalan: string; A: string; B: string; C: string; D: string; jawapan: string };
let bankCache: { at: number; bank: Record<string, Soalan> } | null = null;
async function loadBankSoalan(): Promise<Record<string, Soalan>> {
  if (bankCache && Date.now() - bankCache.at < 300000) return bankCache.bank;
  const { data, error } = await db.from("soalan").select("*");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("Bank soalan kosong.");
  const bank: Record<string, Soalan> = {};
  data.forEach((r) => {
    const id = String(r.id).trim();
    bank[id] = {
      id, topik: String(r.topik || "").toUpperCase().trim(), aras: String(r.aras || "").toLowerCase().trim(),
      soalan: String(r.soalan || ""), A: String(r.a || ""), B: String(r.b || ""),
      C: String(r.c || ""), D: String(r.d || ""), jawapan: normHuruf(r.jawapan),
    };
  });
  bankCache = { at: Date.now(), bank };
  return bank;
}
async function loadBankS3P1(): Promise<Record<string, Soalan & { set: number }>> {
  const { data, error } = await db.from("soalan_s3p1").select("*");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("SoalanS3P1 kosong.");
  const bank: Record<string, Soalan & { set: number }> = {};
  data.forEach((r) => {
    const id = String(r.no).trim();
    bank[id] = {
      id, set: Number(r.set_no), topik: "", aras: String(r.aras || "").toLowerCase(),
      soalan: String(r.soalan || ""), A: String(r.a || ""), B: String(r.b || ""),
      C: String(r.c || ""), D: String(r.d || ""), jawapan: normHuruf(r.jawapan),
    };
  });
  return bank;
}

// ================= Cabutan (port dari simulate_draw yang disahkan) =================
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function sample(pool: string[], n: number, label: string): string[] {
  if (pool.length < n) throw new Error("Soalan tidak cukup untuk " + label);
  return shuffle(pool).slice(0, n);
}
function buildKertas(bank: Record<string, Soalan>, exclude: Record<string, boolean> = {}) {
  const topikLapan = shuffle(TOPIK_LIST)[0];
  let ids: string[] = [];
  for (const topik of TOPIK_LIST) {
    const nTing = topik === topikLapan ? 4 : 3;
    const sed: string[] = [], ting: string[] = [];
    for (const id of Object.keys(bank)) {
      if (exclude[id]) continue;
      const q = bank[id];
      if (q.topik !== topik) continue;
      if (q.aras === "sederhana") sed.push(id);
      else if (q.aras === "tinggi") ting.push(id);
    }
    ids = ids.concat(sample(sed, 4, topik + " sederhana"), sample(ting, nTing, topik + " tinggi"));
  }
  if (ids.length !== JUMLAH_SOALAN) throw new Error("Cabutan gagal: " + ids.length);
  return { ids: shuffle(ids), topik_lapan: topikLapan };
}
function stripJawapan(qs: Soalan[]) {
  return qs.map((q) => ({ id: q.id, soalan: q.soalan, A: q.A, B: q.B, C: q.C, D: q.D }));
}
function qsFromIds(bank: Record<string, Soalan>, ids: string[]): Soalan[] {
  return ids.map((id) => { if (!bank[id]) throw new Error("Soalan id " + id + " tiada."); return bank[id]; });
}
function gred(qs: Soalan[], jawapanMap: Json) {
  let betul = 0;
  const butiran = qs.map((q, i) => {
    const pel = normHuruf(jawapanMap[q.id]);
    const ok = pel === q.jawapan;
    if (ok) betul++;
    return { id: q.id, topik: q.topik || "", aras: q.aras || "", nombor: i + 1, soalan: q.soalan,
             jawapan_pelajar: pel || "-", jawapan_betul: q.jawapan, betul: ok };
  });
  const jumlah = qs.length;
  return { betul, jumlah, skor: jumlah ? Math.round((betul / jumlah) * 100) : 0, butiran };
}

// ================= Masa =================
const toMs = (v: unknown) => { if (!v) return Number.MAX_SAFE_INTEGER; const d = new Date(v as string); return isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime(); };
function fmtMasa(v: unknown): string {
  if (!v) return "-";
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString("ms-MY", { hour12: false });
}
function fmtTempoh(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  if (h > 0) return `${p(h)} jam ${p(m)} min ${p(sec)} saat`;
  if (m > 0) return `${m} min ${p(sec)} saat`;
  return `${sec} saat`;
}
function timingS1S2(masaMula: unknown) {
  const start = toMs(masaMula), end = start + TEMPOH_KUIZ_MS;
  return { masa_mula_ms: start, batas_masa_ms: end, masa_mula_label: fmtMasa(masaMula),
           batas_masa_label: fmtMasa(new Date(end).toISOString()), tempoh_kuiz_minit: 60 };
}

// ================= Percubaan helpers =================
async function servedIdsForIc(ic: string): Promise<Record<string, boolean>> {
  const { data } = await db.from("percubaan").select("soalan_ids").eq("ic", ic);
  const served: Record<string, boolean> = {};
  (data || []).forEach((r) => (r.soalan_ids || []).forEach((id: string) => { served[String(id).trim()] = true; }));
  return served;
}

// ================= Senarai peserta (senarai putih log masuk) =================
async function whitelistAktif(): Promise<boolean> {
  const { data } = await db.from("peserta").select("id").limit(1);
  return !!(data && data.length);
}
async function getPesertaByIc(ic: string): Promise<{ ic: string; nama: string; daerah: string; sekolah: string } | null> {
  const { data } = await db.from("peserta").select("ic,nama,daerah,sekolah").eq("ic", ic).maybeSingle();
  if (!data) return null;
  return { ic: normIc(data.ic), nama: String(data.nama || ""), daerah: normDaerah(data.daerah), sekolah: String(data.sekolah || "") };
}
// Pratonton pengesahan sebelum mula kuiz (IC -> nama/daerah/sekolah).
export async function pesertaInfo(icRaw: unknown) {
  const ic = normIc(icRaw);
  if (!ic || ic.length < 6) return { ok: false, ralat: "No. Kad Pengenalan tidak sah." };
  const p = await getPesertaByIc(ic);
  if (!p) return { ok: false, ralat: "IC ini tiada dalam senarai peserta. Sila semak semula atau maklumkan pengawas." };
  const namaMap = await daerahNamaMap();
  return { ok: true, ic: p.ic, nama: p.nama, daerah: p.daerah, nama_daerah: namaMap[p.daerah] || p.daerah, sekolah: p.sekolah };
}

// ================= PELAJAR: getInit =================
export async function getInit() {
  const peringkat = await getPeringkatAktif();
  let daerah = await getDaerahList();
  // S3P1: hanya papar daerah yang LAYAK (pasukan finalis) untuk dipilih pelajar.
  if (peringkat === "S3P1") {
    const layak = await getKelayakan(peringkat);
    daerah = daerah.filter((d) => layak[d.kod]);
  }
  return {
    ok: true, peringkat_aktif: peringkat, peringkat_label: PERINGKAT_LABEL[peringkat] || peringkat,
    dibuka: PERINGKAT_PELAJAR.includes(peringkat), daerah,
    guna_peserta: await whitelistAktif(),
  };
}

function parseIcs(icsRaw: unknown, icRaw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(icsRaw)) arr = icsRaw;
  else if (typeof icsRaw === "string" && icsRaw.includes(",")) arr = icsRaw.split(",");
  else if (icRaw != null && String(icRaw).includes(",")) arr = String(icRaw).split(",");
  else if (icRaw != null && String(icRaw).trim()) arr = [icRaw];
  return arr.map(normIc).filter(Boolean);
}

async function ahliPasukanS1(daerah: string): Promise<{ ic: string; nama: string }[]> {
  const { data } = await db.from("percubaan")
    .select("ic,nama,skor,masa_mula,masa_hantar")
    .eq("peringkat", "S1").eq("status", "selesai").eq("daerah", daerah);
  const best: Record<string, { ic: string; nama: string; skor: number; tempoh: number }> = {};
  (data || []).forEach((r) => {
    const ic = normIc(r.ic);
    if (!ic) return;
    const start = toMs(r.masa_mula), end = toMs(r.masa_hantar);
    const tempoh = start <= end && start < Number.MAX_SAFE_INTEGER ? end - start : Number.MAX_SAFE_INTEGER;
    const skor = Number(r.skor);
    const cur = best[ic];
    if (!cur || skor > cur.skor || (skor === cur.skor && tempoh < cur.tempoh)) {
      best[ic] = { ic, nama: String(r.nama || ""), skor, tempoh };
    }
  });
  return Object.values(best)
    .sort((a, b) => (b.skor !== a.skor ? b.skor - a.skor : a.tempoh - b.tempoh))
    .slice(0, 3)
    .map((a) => ({ ic: a.ic, nama: a.nama }));
}

// ================= PELAJAR: startExam =================
export async function startExam(icRaw: unknown, namaRaw: unknown, daerahRaw: unknown, icsRaw?: unknown) {
  const peringkat = await getPeringkatAktif();
  if (!PERINGKAT_PELAJAR.includes(peringkat)) return { ok: false, ralat: "Peperiksaan belum dibuka. Sila tunggu arahan pengawas." };

  // Peringkat pasukan (S3P1): kekal seperti sedia ada — daerah + tiga IC.
  if (peringkat === "S3P1") {
    const daerah = normDaerah(daerahRaw);
    if (!daerah) return { ok: false, ralat: "Sila pilih daerah." };
    if (!(await isValidDaerah(daerah))) return { ok: false, ralat: "Daerah tidak sah." };
    if (!(await isLayak(peringkat, daerah))) return { ok: false, ralat: "Daerah anda tidak layak untuk peringkat ini." };
    const ics = parseIcs(icsRaw, icRaw);
    if (ics.length !== 3) return { ok: false, ralat: "Sila isi tiga nombor kad pengenalan ahli pasukan." };
    if (new Set(ics).size !== 3) return { ok: false, ralat: "Tiga IC mesti berbeza." };
    if (ics.some((ic) => ic.length < 6)) return { ok: false, ralat: "No. Kad Pengenalan tidak sah." };
    return startS3P1(ics, daerah);
  }

  // Peringkat individu (S1).
  const ic = normIc(icRaw);
  if (!ic || ic.length < 6) return { ok: false, ralat: "No. Kad Pengenalan tidak sah." };

  // Jika senarai peserta ada: sahkan IC dalam senarai; nama & daerah diambil dari
  // senarai (abaikan input pelanggan) supaya tiada penyamaran / salah daerah.
  if (await whitelistAktif()) {
    const p = await getPesertaByIc(ic);
    if (!p) return { ok: false, ralat: "Anda tiada dalam senarai peserta. Sila maklumkan pengawas." };
    return startS1S2(peringkat, p.ic, p.nama, p.daerah);
  }

  // Sandaran (senarai kosong): cara lama — perlu daerah & nama.
  const daerah = normDaerah(daerahRaw), nama = normNama(namaRaw);
  if (!daerah) return { ok: false, ralat: "Sila pilih daerah." };
  if (!(await isValidDaerah(daerah))) return { ok: false, ralat: "Daerah tidak sah." };
  if (!nama) return { ok: false, ralat: "Nama penuh diperlukan." };
  return startS1S2(peringkat, ic, nama, daerah);
}

async function startS1S2(peringkat: string, ic: string, nama: string, daerah: string) {
  const bank = await loadBankSoalan();
  const { data: existing } = await db.from("percubaan").select("*").eq("peringkat", peringkat).eq("ic", ic).order("masa_mula", { ascending: false });
  const done = (existing || []).find((r) => r.status === "selesai");
  if (done) return { ok: false, sudah_hantar: true, ralat: "Anda telah menghantar peperiksaan ini.", mesej_terima_kasih: MSJ_TERIMA_KASIH };
  const active = (existing || []).find((r) => r.status === "sedang");
  if (active) {
    const t = timingS1S2(active.masa_mula);
    if (Date.now() > t.batas_masa_ms) return { ok: false, ralat: "Masa kuiz 1 jam telah tamat. Sila hubungi pengawas." };
    return { ok: true, peringkat, attempt_id: active.id, nama: active.nama || nama, daerah: active.daerah || daerah,
             soalan: stripJawapan(qsFromIds(bank, active.soalan_ids)), jumlah: active.soalan_ids.length, sambungan: true, ...t };
  }
  const exclude = peringkat === "S2" ? await servedIdsForIc(ic) : {};
  const kertas = buildKertas(bank, exclude);
  const masaMula = new Date().toISOString();
  const { data: ins, error } = await db.from("percubaan").insert({
    peringkat, ic, nama, daerah, soalan_ids: kertas.ids, topik_lapan: kertas.topik_lapan, status: "sedang", masa_mula: masaMula,
  }).select().single();
  if (error) {
    // Perlumbaan: kemungkinan sudah wujud — ambil semula
    const { data: again } = await db.from("percubaan").select("*").eq("peringkat", peringkat).eq("ic", ic).order("masa_mula", { ascending: false });
    const a = (again || [])[0];
    if (a) {
      if (a.status === "selesai") return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
      return { ok: true, peringkat, attempt_id: a.id, nama: a.nama, daerah: a.daerah,
               soalan: stripJawapan(qsFromIds(bank, a.soalan_ids)), jumlah: a.soalan_ids.length, sambungan: true, ...timingS1S2(a.masa_mula) };
    }
    throw new Error(error.message);
  }
  return { ok: true, peringkat, attempt_id: ins.id, nama, daerah,
           soalan: stripJawapan(qsFromIds(bank, kertas.ids)), jumlah: kertas.ids.length, sambungan: false, ...timingS1S2(masaMula) };
}

async function startS3P1(ics: string[], daerah: string) {
  const ahli = await ahliPasukanS1(daerah);
  if (ahli.length < 3) return { ok: false, ralat: "Ahli pasukan belum lengkap. Sila hubungi pentadbir." };
  const expected = new Set(ahli.map((a) => a.ic));
  if (!ics.every((ic) => expected.has(ic))) {
    return { ok: false, ralat: "IC tidak sepadan dengan ahli pasukan daerah ini. Sila semak semula." };
  }
  const icCanon = [...ics].sort().join(",");
  const namaMap = await daerahNamaMap();
  const nama = "Pasukan " + (namaMap[daerah] || daerah);
  const bank = await loadBankS3P1();
  const { data: team } = await db.from("percubaan").select("*").eq("peringkat", "S3P1").eq("daerah", daerah).maybeSingle();
  if (team) {
    if (team.status === "selesai") return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH, ralat: "Pasukan anda telah menghantar." };
    return { ok: true, peringkat: "S3P1", attempt_id: team.id, ic: icCanon, nama: team.nama || nama, daerah, set: team.set_no,
             soalan: stripJawapan(qsFromIds(bank as Record<string, Soalan>, team.soalan_ids)), jumlah: team.soalan_ids.length,
             saat_sesoalan: S3P1_SAAT, mata_sesoalan: S3P1_MATA, sambungan: true };
  }
  const { data: allS3 } = await db.from("percubaan").select("set_no").eq("peringkat", "S3P1");
  const taken: Record<number, boolean> = {};
  (allS3 || []).forEach((r) => { if (r.set_no) taken[Number(r.set_no)] = true; });
  let avail: number[] = [];
  for (let s = 1; s <= S3P1_SET_COUNT; s++) if (!taken[s]) avail.push(s);
  if (!avail.length) for (let s = 1; s <= S3P1_SET_COUNT; s++) avail.push(s);
  const setNo = shuffle(avail)[0];
  const ids = Object.keys(bank).filter((no) => bank[no].set === setNo).sort((a, b) => Number(a) - Number(b));
  if (ids.length !== S3P1_SOALAN) throw new Error("Set " + setNo + " tidak lengkap.");
  const { data: ins, error } = await db.from("percubaan").insert({
    peringkat: "S3P1", ic: icCanon, nama, daerah, set_no: setNo, soalan_ids: ids, status: "sedang", masa_mula: new Date().toISOString(),
  }).select().single();
  if (error) {
    const { data: again } = await db.from("percubaan").select("*").eq("peringkat", "S3P1").eq("daerah", daerah).maybeSingle();
    if (again) {
      if (again.status === "selesai") return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH, ralat: "Pasukan anda telah menghantar." };
      return { ok: true, peringkat: "S3P1", attempt_id: again.id, ic: icCanon, nama: again.nama || nama, daerah, set: again.set_no,
               soalan: stripJawapan(qsFromIds(bank as Record<string, Soalan>, again.soalan_ids)), jumlah: again.soalan_ids.length,
               saat_sesoalan: S3P1_SAAT, mata_sesoalan: S3P1_MATA, sambungan: true };
    }
    throw new Error(error.message);
  }
  return { ok: true, peringkat: "S3P1", attempt_id: ins.id, ic: icCanon, nama, daerah, set: setNo,
           soalan: stripJawapan(qsFromIds(bank as Record<string, Soalan>, ids)), jumlah: ids.length,
           saat_sesoalan: S3P1_SAAT, mata_sesoalan: S3P1_MATA, sambungan: false };
}

// ================= PELAJAR: submitExam =================
export async function submitExam(icRaw: unknown, attemptId: unknown, jawapan: unknown) {
  const ic = normIc(icRaw);
  if (!ic) return { ok: false, ralat: "IC diperlukan." };
  if (!attemptId) return { ok: false, ralat: "attempt_id diperlukan." };
  const { data: attempt } = await db.from("percubaan").select("*").eq("id", attemptId).maybeSingle();
  if (!attempt) return { ok: false, ralat: "Percubaan tidak dijumpai." };
  if (attempt.peringkat !== "S3P1" && attempt.ic !== ic) return { ok: false, ralat: "Percubaan tidak sepadan dengan IC." };
  if (attempt.status === "selesai") return { ok: false, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH, ralat: "Jawapan telah dihantar." };

  const jmap = (jawapan as Json) || {};
  let graded, mata: number, skor: number;
  if (attempt.peringkat === "S3P1") {
    const bank = await loadBankS3P1();
    graded = gred(qsFromIds(bank as Record<string, Soalan>, attempt.soalan_ids), jmap);
    mata = graded.betul * S3P1_MATA; skor = graded.skor;
  } else {
    const t = timingS1S2(attempt.masa_mula);
    if (Date.now() > t.batas_masa_ms) return { ok: false, ralat: "Masa kuiz 1 jam telah tamat. Sila hubungi pengawas." };
    const bank = await loadBankSoalan();
    graded = gred(qsFromIds(bank, attempt.soalan_ids), jmap);
    mata = graded.betul; skor = graded.skor;
  }
  const masaHantar = new Date().toISOString();
  await db.from("percubaan").update({ status: "selesai", masa_hantar: masaHantar, betul: graded.betul, jumlah: graded.jumlah, skor, mata, jawapan: jmap, butiran: graded.butiran }).eq("id", attempt.id);
  return { ok: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
}

// ================= PELAJAR: getResult =================
export async function getResult(icRaw: unknown, daerahRaw: unknown) {
  const ic = normIc(icRaw), daerah = normDaerah(daerahRaw);
  if (!ic) return { ok: false, ralat: "IC diperlukan." };
  const peringkat = await getPeringkatAktif();
  let q = db.from("percubaan").select("id").eq("peringkat", peringkat).eq("status", "selesai");
  q = peringkat === "S3P1" ? q.eq("daerah", daerah) : q.eq("ic", ic);
  const { data } = await q.limit(1);
  if (data && data.length) return { ok: true, sudah_hantar: true, mesej_terima_kasih: MSJ_TERIMA_KASIH };
  return { ok: false, ralat: "Tiada rekod peperiksaan." };
}

// ================= PENTADBIR =================
function requirePin(pin: unknown): { ok: boolean; ralat?: string } {
  const admin = getAdminPin();
  if (!admin) return { ok: false, ralat: "ADMIN_PIN belum dikonfigurasi." };
  if (normPin(pin) !== admin) return { ok: false, ralat: "PIN tidak sah." };
  return { ok: true };
}

type KRow = { attempt_id: string; ic: string; nama: string; daerah: string; betul: number; jumlah: number; skor: number; mata: number; masa_hantar: unknown; tempoh_ms: number; tempoh_label: string; butiran: unknown };
async function loadKeputusan(peringkat: string): Promise<KRow[]> {
  const { data } = await db.from("percubaan").select("*").eq("peringkat", peringkat).eq("status", "selesai");
  if (!data || !data.length) return [];
  return data.map((r) => {
    const start = toMs(r.masa_mula); const end = toMs(r.masa_hantar);
    const tempoh = start <= end && start < Number.MAX_SAFE_INTEGER ? end - start : Number.MAX_SAFE_INTEGER;
    return { attempt_id: r.id, ic: normIc(r.ic), nama: String(r.nama || ""), daerah: normDaerah(r.daerah),
             betul: Number(r.betul), jumlah: Number(r.jumlah), skor: Number(r.skor), mata: Number(r.mata || 0),
             masa_hantar: r.masa_hantar, tempoh_ms: tempoh, tempoh_label: fmtTempoh(tempoh), butiran: r.butiran };
  });
}

async function buildRanking(peringkat: string) {
  const rows = await loadKeputusan(peringkat);
  const namaMap = await daerahNamaMap();
  const bestByIc: Record<string, KRow> = {};
  rows.forEach((r) => {
    const c = bestByIc[r.ic];
    if (!c || r.skor > c.skor || (r.skor === c.skor && r.tempoh_ms < c.tempoh_ms)) bestByIc[r.ic] = r;
  });
  const individu = Object.values(bestByIc).sort((a, b) => (b.skor !== a.skor ? b.skor - a.skor : a.tempoh_ms - b.tempoh_ms));
  const individuOut = individu.map((r, i) => ({ kedudukan: i + 1, ic: r.ic, nama: r.nama, daerah: r.daerah,
    nama_daerah: namaMap[r.daerah] || r.daerah, betul: r.betul, jumlah: r.jumlah, skor: r.skor, mata: r.mata, tempoh_label: r.tempoh_label }));

  const byDaerah: Record<string, KRow[]> = {};
  individu.forEach((r) => { (byDaerah[r.daerah] = byDaerah[r.daerah] || []).push(r); });
  const pasukan = Object.keys(byDaerah).map((d) => {
    const anggota = byDaerah[d].slice().sort((a, b) => (b.skor !== a.skor ? b.skor - a.skor : a.tempoh_ms - b.tempoh_ms)).slice(0, 3);
    let mata = 0, skor = 0, tempoh = 0;
    anggota.forEach((a) => { mata += a.mata; skor += a.skor; tempoh += a.tempoh_ms; });
    return { daerah: d, nama_daerah: namaMap[d] || d, bil_ahli: byDaerah[d].length, jumlah_skor: skor, jumlah_mata: mata, tempoh_ms: tempoh, tempoh_label: fmtTempoh(tempoh), kedudukan: 0 };
  });
  pasukan.sort((a, b) => (b.jumlah_skor !== a.jumlah_skor ? b.jumlah_skor - a.jumlah_skor : a.tempoh_ms - b.tempoh_ms));
  pasukan.forEach((p, i) => { p.kedudukan = i + 1; });
  return { individu: individuOut, pasukan };
}

export async function adminState(pin: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const { data } = await db.from("percubaan").select("peringkat").eq("status", "selesai");
  const counts: Record<string, number> = {};
  (data || []).forEach((r) => { const p = String(r.peringkat).toUpperCase(); counts[p] = (counts[p] || 0) + 1; });
  return { ok: true, peringkat_aktif: await getPeringkatAktif(), peringkat_label: PERINGKAT_LABEL, jumlah_keputusan: counts,
           daerah: await getDaerahList(), kelayakan: { S3P1: Object.keys(await getKelayakan("S3P1")) },
           s3p3: await loadS3p3Marks() };
}

async function loadS3p3Marks(): Promise<Record<string, { mata1: number; mata2: number; mata3: number }>> {
  const { data } = await db.from("markah_manual").select("daerah,mata1,mata2,mata3").eq("peringkat", "S3P3");
  const out: Record<string, { mata1: number; mata2: number; mata3: number }> = {};
  (data || []).forEach((r) => {
    out[normDaerah(r.daerah)] = {
      mata1: Number(r.mata1 || 0), mata2: Number(r.mata2 || 0), mata3: Number(r.mata3 || 0),
    };
  });
  return out;
}

export async function adminSetPeringkat(pin: unknown, peringkat: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const p = String(peringkat || "").toUpperCase();
  if (!["S1", "S3P1", "S3P2", "S3P3", "TUTUP"].includes(p)) return { ok: false, ralat: "Peringkat tidak sah." };
  await setTetapan("peringkat_aktif", p);
  return { ok: true, peringkat_aktif: p, mesej: "Peringkat aktif: " + (PERINGKAT_LABEL[p] || p) };
}

export async function adminRanking(pin: unknown, peringkat: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const p = String(peringkat || (await getPeringkatAktif())).toUpperCase();
  const rk = await buildRanking(p);
  return { ok: true, peringkat: p, peringkat_label: PERINGKAT_LABEL[p] || p, individu: rk.individu, pasukan: rk.pasukan };
}

export async function adminReview(pin: unknown, peringkat: unknown, icRaw: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const ic = normIc(icRaw);
  if (!ic) return adminRanking(pin, peringkat);
  const p = String(peringkat || (await getPeringkatAktif())).toUpperCase();
  const rows = (await loadKeputusan(p)).filter((r) => r.ic === ic).sort((a, b) => b.skor - a.skor);
  if (!rows.length) return { ok: false, ralat: "Tiada rekod untuk IC ini pada peringkat " + p + "." };
  const row = rows[0];
  const namaMap = await daerahNamaMap();
  // Perkayakan butiran dengan teks pilihan A-D (untuk paparan soalan penuh)
  const bank = p === "S3P1"
    ? (await loadBankS3P1()) as Record<string, Soalan>
    : await loadBankSoalan();
  const butiran = ((row.butiran as Array<Record<string, unknown>>) || []).map((b) => {
    const q = bank[String(b.id)];
    return q ? { ...b, A: q.A, B: q.B, C: q.C, D: q.D } : b;
  });
  return { ok: true, peringkat: p, ic, nama: row.nama, daerah: row.daerah, nama_daerah: namaMap[row.daerah] || row.daerah,
           betul: row.betul, jumlah: row.jumlah, salah: row.jumlah - row.betul, skor: row.skor, mata: row.mata,
           masa_hantar: fmtMasa(row.masa_hantar), tempoh_label: row.tempoh_label, butiran };
}

// Auto-kunci N pasukan teratas berdasarkan ranking peringkat sebelumnya.
const ADVANCE: Record<string, { source: string; n: number }> = {
  S3P1: { source: "S1", n: 4 },
};
export async function adminAutoLock(pin: unknown, peringkat: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const target = String(peringkat || "").toUpperCase();
  const cfg = ADVANCE[target];
  if (!cfg) return { ok: false, ralat: "Hanya S3P1 boleh dikunci." };
  const rk = await buildRanking(cfg.source);
  if (!rk.pasukan.length) return { ok: false, ralat: "Tiada keputusan " + cfg.source + " untuk menentukan kelayakan." };
  const list = rk.pasukan.slice(0, cfg.n).map((p) => p.daerah);
  await db.from("kelayakan").delete().eq("peringkat", target);
  await db.from("kelayakan").insert(list.map((d) => ({ peringkat: target, daerah: d })));
  const namaMap = await daerahNamaMap();
  return { ok: true, peringkat: target, daerah: list, nama_daerah: list.map((d) => namaMap[d] || d),
           mesej: list.length + " pasukan teratas " + cfg.source + " dikunci ke " + target + "." };
}

export async function adminLock(pin: unknown, peringkat: unknown, daerahList: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const p = String(peringkat || "").toUpperCase();
  if (p !== "S3P1") return { ok: false, ralat: "Hanya S3P1 boleh dikunci." };
  let list: string[] = typeof daerahList === "string" ? daerahList.split(",") : (daerahList as string[]) || [];
  list = list.map(normDaerah).filter(Boolean);
  if (!list.length) return { ok: false, ralat: "Senarai daerah kosong." };
  await db.from("kelayakan").delete().eq("peringkat", p);
  await db.from("kelayakan").insert(list.map((d) => ({ peringkat: p, daerah: d })));
  return { ok: true, peringkat: p, daerah: list, mesej: list.length + " pasukan dikunci untuk " + p + "." };
}

const SKRIN_KEY = "rebutan_skrin";

type RebutanFlow = {
  fasa: string;
  cuba1: string;
  cuba2: string;
  hasil: string;
  log: { kod: string; mata: number; jenis: string }[];
  undo: Record<string, unknown>[];
  streak0: Record<string, number> | null;
};

type SkrinState = {
  idx: number;
  revealed: number[];
  pilihan: string;
  streak: Record<string, number>;
  flow: Record<string, RebutanFlow>;
};

function emptySkrin(pilihan = ""): SkrinState {
  return { idx: 0, revealed: [], pilihan, streak: {}, flow: {} };
}

function parseStreak(raw: unknown): Record<string, number> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k] = Math.max(0, Math.min(3, Math.floor(n)));
  }
  return out;
}

function parseFlow(raw: unknown): Record<string, RebutanFlow> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, RebutanFlow> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || typeof v !== "object" || !v || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const log = Array.isArray(o.log) ? o.log.map((row) => {
      const r = row as Record<string, unknown>;
      return { kod: String(r.kod || ""), mata: Number(r.mata || 0), jenis: String(r.jenis || "") };
    }).filter((r) => r.kod && Number.isFinite(r.mata) && r.mata !== 0) : [];
    const undo = Array.isArray(o.undo) ? o.undo.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : [];
    out[k] = {
      fasa: String(o.fasa || "tunggu1"),
      cuba1: String(o.cuba1 || ""),
      cuba2: String(o.cuba2 || ""),
      hasil: String(o.hasil || ""),
      log,
      undo,
      streak0: parseStreak(o.streak0),
    };
  }
  return out;
}

async function loadSkrinState(): Promise<SkrinState> {
  try {
    const raw = await getTetapan(SKRIN_KEY, "");
    if (!raw) return emptySkrin();
    const o = JSON.parse(raw) as { idx?: unknown; revealed?: unknown; pilihan?: unknown; streak?: unknown; flow?: unknown };
    const revealed = Array.isArray(o.revealed)
      ? o.revealed.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    return {
      idx: Math.max(0, Number(o.idx) || 0),
      revealed,
      pilihan: String(o.pilihan || ""),
      streak: parseStreak(o.streak) || {},
      flow: parseFlow(o.flow) || {},
    };
  } catch {
    return emptySkrin();
  }
}

export async function adminRebutanSkrin(pin: unknown, idxRaw: unknown, revealedRaw: unknown, streakRaw?: unknown, flowRaw?: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const pilihan = await getTetapan("rebutan_pilihan", "");
  const prev = await loadSkrinState();
  const revealed = Array.isArray(revealedRaw)
    ? revealedRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const streak = parseStreak(streakRaw);
  const flow = parseFlow(flowRaw);
  await setTetapan(SKRIN_KEY, JSON.stringify({
    idx: Math.max(0, Number(idxRaw) || 0),
    revealed,
    pilihan,
    streak: streak || prev.streak,
    flow: flow || prev.flow,
  }));
  return { ok: true };
}

// ---- Rebutan S3P2 ----
export async function adminRebutanSoalan(pin: unknown, pilihSemula?: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const { data } = await db.from("soalan_rebutan").select("*");
  const bank = (data || []).map((r) => ({ no: Number(r.no), topik: String(r.topik || ""), soalan: String(r.soalan || ""),
    A: String(r.a || ""), B: String(r.b || ""), C: String(r.c || ""), D: String(r.d || ""), jawapan: normHuruf(r.jawapan) }));
  if (!bank.length) return { ok: false, ralat: "SoalanRebutan kosong." };
  let pilihan = (await getTetapan("rebutan_pilihan", "")).split(",").map((s) => s.trim()).filter(Boolean);
  const semula = pilihSemula === true || String(pilihSemula) === "true" || !pilihan.length;
  if (semula) {
    pilihan = shuffle(bank.map((q) => String(q.no))).slice(0, REBUTAN_PILIH);
    await setTetapan("rebutan_pilihan", pilihan.join(","));
    await setTetapan(SKRIN_KEY, JSON.stringify(emptySkrin(pilihan.join(","))));
  }
  const byNo: Record<string, typeof bank[0]> = {}; bank.forEach((q) => { byNo[String(q.no)] = q; });
  const soalan = pilihan.map((no, i) => { const q = byNo[no]; return q ? { urutan: i + 1, ...q } : null; }).filter(Boolean);
  let skrin = await loadSkrinState();
  if (skrin.pilihan && skrin.pilihan !== pilihan.join(",")) {
    skrin = emptySkrin(pilihan.join(","));
    await setTetapan(SKRIN_KEY, JSON.stringify(skrin));
  }
  const maxIdx = Math.max(0, soalan.length - 1);
  return {
    ok: true, soalan, daerah_layak: Object.keys(await getKelayakan("S3P1")),
    skrin: { idx: Math.min(maxIdx, skrin.idx), revealed: skrin.revealed, streak: skrin.streak, flow: skrin.flow },
  };
}

export async function adminRebutanScore(pin: unknown, noSoalan: unknown, daerahRaw: unknown, betul: unknown, mata: unknown, catatanRaw?: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const daerah = normDaerah(daerahRaw);
  if (!daerah) return { ok: false, ralat: "Daerah diperlukan." };
  const isBetul = betul === true || String(betul) === "true";
  const m = Number(mata != null ? mata : isBetul ? 4 : 0);
  if (!Number.isFinite(m) || m === 0) return { ok: false, ralat: "Mata tidak sah." };
  const catatan = String(catatanRaw || (m > 0 ? "betul" : "pindaan")).slice(0, 40);
  await db.from("rebutan_log").insert({
    no_soalan: noSoalan ? Number(noSoalan) : null, daerah, betul: m > 0, mata: m,
    catatan, masa: new Date().toISOString(),
  });
  return { ok: true, mesej: "Direkod: " + daerah + " " + (m > 0 ? "+" : "") + m + " mata." };
}

// Markah rebutan semasa setiap pasukan finalis (untuk papan skor di skrin).
export async function adminRebutanState(pin: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const finalists = Object.keys(await getKelayakan("S3P1"));
  const namaMap = await daerahNamaMap();
  const { data } = await db.from("rebutan_log").select("daerah,mata");
  const tot: Record<string, number> = {};
  (data || []).forEach((r) => { const d = normDaerah(r.daerah); tot[d] = (tot[d] || 0) + Number(r.mata || 0); });
  const pasukan = finalists.map((d) => ({ daerah: d, nama_daerah: namaMap[d] || d, mata: tot[d] || 0 }))
    .sort((a, b) => b.mata - a.mata);
  return { ok: true, pasukan };
}

// ---- Markah manual S3P3 (3 soalan, dijumlah) ----
export async function adminSetManual(pin: unknown, peringkat: unknown, daerahRaw: unknown, mata1: unknown, mata2: unknown, mata3: unknown, catatan: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const p = String(peringkat || "S3P3").toUpperCase();
  const daerah = normDaerah(daerahRaw);
  if (!daerah) return { ok: false, ralat: "Daerah diperlukan." };
  const satu = (v: unknown) => (p === "S3P3" ? (Number(v) > 0 ? 6 : 0) : Number(v || 0));
  const m1 = satu(mata1), m2 = satu(mata2), m3 = satu(mata3);
  const total = m1 + m2 + m3;
  await db.from("markah_manual").upsert(
    { peringkat: p, daerah, mata: total, mata1: m1, mata2: m2, mata3: m3, catatan: String(catatan || ""), masa: new Date().toISOString() },
    { onConflict: "peringkat,daerah" }
  );
  return { ok: true, mesej: "Markah " + p + " " + daerah + " disimpan: " + m1 + "+" + m2 + "+" + m3 + " = " + total };
}

// ---- Kedudukan akhir ----
export async function adminFinal(pin: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const namaMap = await daerahNamaMap();
  const agg: Record<string, { daerah: string; nama_daerah: string; s3p1: number; s3p2: number; s3p3: number; s3p3_1: number; s3p3_2: number; s3p3_3: number; jumlah: number; kedudukan: number }> = {};
  const ensure = (d: string) => (agg[d] = agg[d] || { daerah: d, nama_daerah: namaMap[d] || d, s3p1: 0, s3p2: 0, s3p3: 0, s3p3_1: 0, s3p3_2: 0, s3p3_3: 0, jumlah: 0, kedudukan: 0 });
  (await loadKeputusan("S3P1")).forEach((r) => { ensure(r.daerah).s3p1 += r.mata; });
  const { data: reb } = await db.from("rebutan_log").select("daerah,mata");
  (reb || []).forEach((r) => { if (r.daerah) ensure(normDaerah(r.daerah)).s3p2 += Number(r.mata || 0); });
  const { data: man } = await db.from("markah_manual").select("daerah,mata,mata1,mata2,mata3").eq("peringkat", "S3P3");
  (man || []).forEach((r) => { const a = ensure(normDaerah(r.daerah)); a.s3p3 += Number(r.mata || 0); a.s3p3_1 = Number(r.mata1 || 0); a.s3p3_2 = Number(r.mata2 || 0); a.s3p3_3 = Number(r.mata3 || 0); });
  const list = Object.values(agg).map((a) => { a.jumlah = a.s3p1 + a.s3p2 + a.s3p3; return a; });
  list.sort((a, b) => b.jumlah - a.jumlah);
  list.forEach((a, i) => { a.kedudukan = i + 1; });
  return { ok: true, kedudukan: list };
}

// ---- Reset ----
export async function adminReset(pin: unknown, skop: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const s = String(skop || "semua").toLowerCase();
  const delAll = async (t: string) => { await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000"); };
  const clearPusingan2 = async () => {
    await delAll("rebutan_log");
    await setTetapan("rebutan_pilihan", "");
    await setTetapan("rebutan_skrin", "");
  };
  if (s === "s3p2" || s === "rebutan" || s === "pusingan2") {
    await clearPusingan2();
    return { ok: true, mesej: "Pusingan 2 dikosongkan. Buka semula skrin untuk cabut soalan baharu." };
  }
  if (s === "semua" || s === "percubaan") { await delAll("percubaan"); }
  if (s === "semua") {
    await clearPusingan2();
    await db.from("markah_manual").delete().neq("daerah", "___none___");
    await db.from("kelayakan").delete().neq("daerah", "___none___");
  }
  return { ok: true, mesej: "Reset (" + s + ") selesai. Bank soalan & daerah tidak diubah." };
}

// ================= PENTADBIR: Pengurusan Peserta =================
// Senarai peserta ini (daerah + IC + nama + sekolah) juga menjadi senarai putih
// untuk sahkan log masuk peserta kelak.
export async function adminPesertaList(pin: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const { data, error } = await db.from("peserta").select("id,daerah,ic,nama,sekolah").order("daerah").order("nama");
  if (error) return { ok: false, ralat: error.message };
  const namaMap = await daerahNamaMap();
  const peserta = (data || []).map((r) => {
    const d = normDaerah(r.daerah);
    return { id: r.id, daerah: d, nama_daerah: namaMap[d] || d,
             ic: normIc(r.ic), nama: String(r.nama || ""), sekolah: String(r.sekolah || "") };
  });
  return { ok: true, peserta, daerah: await getDaerahList() };
}

export async function adminPesertaSave(pin: unknown, idRaw: unknown, daerahRaw: unknown, icRaw: unknown, namaRaw: unknown, sekolahRaw: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const daerah = normDaerah(daerahRaw);
  const ic = normIc(icRaw);
  const nama = normNama(namaRaw);
  const sekolah = String(sekolahRaw ?? "").trim();
  const id = String(idRaw ?? "").trim();
  if (!daerah) return { ok: false, ralat: "Sila pilih daerah." };
  if (!(await isValidDaerah(daerah))) return { ok: false, ralat: "Daerah tidak sah." };
  if (!ic || ic.length < 6) return { ok: false, ralat: "No. Kad Pengenalan tidak sah." };
  if (!nama) return { ok: false, ralat: "Nama penuh diperlukan." };
  // Halang IC pendua (milik rekod lain)
  const { data: dup } = await db.from("peserta").select("id").eq("ic", ic).maybeSingle();
  if (dup && dup.id !== id) return { ok: false, ralat: "IC ini sudah didaftarkan untuk peserta lain." };
  const row = { daerah, ic, nama, sekolah };
  if (id) {
    const { error } = await db.from("peserta").update(row).eq("id", id);
    if (error) return { ok: false, ralat: error.message };
    return { ok: true, mesej: "Peserta dikemas kini." };
  }
  const { error } = await db.from("peserta").insert(row);
  if (error) return { ok: false, ralat: error.message };
  return { ok: true, mesej: "Peserta ditambah." };
}

export async function adminPesertaDelete(pin: unknown, idRaw: unknown) {
  const chk = requirePin(pin); if (!chk.ok) return chk;
  const id = String(idRaw ?? "").trim();
  if (!id) return { ok: false, ralat: "id diperlukan." };
  const { error } = await db.from("peserta").delete().eq("id", id);
  if (error) return { ok: false, ralat: error.message };
  return { ok: true, mesej: "Peserta dipadam." };
}
