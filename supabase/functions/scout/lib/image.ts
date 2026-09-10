// lib/image.ts — copy a remote event image into our own storage so the app
// never hotlinks a third party. Non-fatal by design: a missing image is a
// pick without a picture, not a failed ingest.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchImage } from "./fetch.ts";

export async function copyImage(sb: SupabaseClient, url: string, key: string): Promise<string | null> {
  try {
    const img = await fetchImage(url);
    const path = `scout/${key}.${img.ext}`;
    const { error } = await sb.storage.from("event-media").upload(path, img.bytes, { contentType: img.contentType, upsert: true, cacheControl: "31536000" });
    if (error) { console.error("image upload", error.message); return null; }
    return path;
  } catch (e) { console.error("image copy", String((e as Error)?.message || e)); return null; }
}
