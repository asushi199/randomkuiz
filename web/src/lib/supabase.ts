import { createClient } from "@supabase/supabase-js";

// Klien pelayan (service role) — hanya digunakan dalam Route Handler, tidak
// pernah didedahkan ke pelayar. Melangkau RLS; logik kebenaran ada di API.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Guna placeholder jika env belum ditetapkan supaya createClient tidak membaling
// semasa build/import. Runtime dilindungi oleh envReady() dalam Route Handler.
export const db = createClient(
  url || "https://placeholder.supabase.co",
  serviceKey || "placeholder-key",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export function getAdminPin(): string {
  return (process.env.ADMIN_PIN || "").trim();
}

export function envReady(): boolean {
  return !!url && !!serviceKey;
}
