import { h } from "https://esm.sh/preact@10.23.2";
import htm from "https://esm.sh/htm@3.1.1";

export const html = htm.bind(h);

/* ---------- formatting ---------- */
export const money = (cents) =>
  "$" + (Math.round(cents / 100)).toLocaleString("en-US");
export const moneyExact = (cents) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 });
export const niceDate = (iso) => {
  try { return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); }
  catch { return iso; }
};
export const niceTime = (t) => {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const ap = hh >= 12 ? "pm" : "am";
  const h12 = ((hh + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
};
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------- avatars ---------- */
const HUES = ["#e85d75", "#219a8f", "#b9852e", "#6b4fbb", "#3a7bd5", "#588c3f"];
export function Avatar({ profile, size = "" }) {
  const name = profile?.display_name || "?";
  // avatar_url is a storage path in the public `avatars` bucket (same as the app)
  const raw = profile?.avatar_url;
  const src = raw
    ? (raw.startsWith("http") ? raw
      : `${window.CA_CONFIG?.SUPABASE_URL || ""}/storage/v1/object/public/avatars/${raw}`)
    : null;
  if (src)
    return html`<img class=${"avatar " + size} src=${src} alt=${name} title=${name} />`;
  const hue = HUES[(name.charCodeAt(0) || 0) % HUES.length];
  return html`<span class=${"avatar ph " + size} style=${`background:${hue}`} title=${name}>${name[0].toUpperCase()}</span>`;
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children }) {
  return html`<div class="overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="modal"><h3>${title}</h3>${children}</div>
  </div>`;
}

/* ---------- storage helpers (event-media bucket) ---------- */
export function mediaUrl(client, path) {
  if (!path) return null;
  try { return client.storage.from("event-media").getPublicUrl(path).data.publicUrl; }
  catch { return null; }
}
export async function uploadMedia(client, prefix, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await client.storage.from("event-media").upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}
