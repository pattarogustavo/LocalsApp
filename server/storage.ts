// Storage helpers backed by Supabase Storage.
// Bucket is private: storagePut/storageGet return a stable /storage/{key}
// pointer, resolved to a fresh signed URL on each access via storageProxy.

import { getSupabaseAdmin } from "./_core/supabaseAdmin";
import { ENV } from "./_core/env";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

function getBucket(): string {
  if (!ENV.supabaseStorageBucket) {
    throw new Error("Storage config missing: set SUPABASE_STORAGE_BUCKET");
  }
  return ENV.supabaseStorageBucket;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);

  const { error } = await getSupabaseAdmin()
    .storage.from(getBucket())
    .upload(key, body, { contentType, upsert: false });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return { key, url: `/storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);

  const { data, error } = await getSupabaseAdmin()
    .storage.from(getBucket())
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? "unknown error"}`);
  }

  return data.signedUrl;
}
