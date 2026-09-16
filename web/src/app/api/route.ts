import { NextRequest, NextResponse } from "next/server";
import { envReady } from "@/lib/supabase";
import * as K from "@/lib/kuiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

async function dispatch(action: string, p: Payload) {
  switch (action) {
    case "getInit": return K.getInit();
    case "startExam": return K.startExam(p.ic, p.nama, p.daerah, p.ics);
    case "submitExam": return K.submitExam(p.ic, p.attempt_id, p.jawapan);
    case "getResult": return K.getResult(p.ic, p.daerah);
    case "adminState": return K.adminState(p.pin);
    case "adminSetPeringkat": return K.adminSetPeringkat(p.pin, p.peringkat);
    case "adminRanking": return K.adminRanking(p.pin, p.peringkat);
    case "adminReview": return K.adminReview(p.pin, p.peringkat, p.ic);
    case "adminLock": return K.adminLock(p.pin, p.peringkat, p.daerah_list);
    case "adminAutoLock": return K.adminAutoLock(p.pin, p.peringkat);
    case "adminRebutanSoalan": return K.adminRebutanSoalan(p.pin, p.pilih_semula);
    case "adminRebutanScore": return K.adminRebutanScore(p.pin, p.no_soalan, p.daerah, p.betul, p.mata, p.catatan);
    case "adminRebutanState": return K.adminRebutanState(p.pin);
    case "adminRebutanSkrin": return K.adminRebutanSkrin(p.pin, p.idx, p.revealed, p.streak, p.flow);
    case "adminSetManual": return K.adminSetManual(p.pin, p.peringkat, p.daerah, p.mata1, p.mata2, p.mata3, p.catatan);
    case "adminFinal": return K.adminFinal(p.pin);
    case "adminReset": return K.adminReset(p.pin, p.skop);
    case "adminPesertaList": return K.adminPesertaList(p.pin);
    case "adminPesertaSave": return K.adminPesertaSave(p.pin, p.id, p.daerah, p.ic, p.nama, p.sekolah);
    case "adminPesertaDelete": return K.adminPesertaDelete(p.pin, p.id);
    default: return { ok: false, ralat: "Tindakan tidak dikenali." };
  }
}

async function handle(action: string, payload: Payload) {
  if (!envReady()) {
    return NextResponse.json({ ok: false, ralat: "Pelayan belum dikonfigurasi (env Supabase tiada)." });
  }
  try {
    const result = await dispatch(action, payload);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, ralat: msg });
  }
}

export async function POST(req: NextRequest) {
  let body: Payload = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ ok: false, ralat: "JSON tidak sah." });
  }
  const action = String(body.action || "");
  return handle(action, body);
}

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries()) as Payload;
  const action = String(params.action || "");
  return handle(action, params);
}
