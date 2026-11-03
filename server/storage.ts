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

const LIST_PAGE_SIZE = 100;

/**
 * Validates that `prefix` is safely scoped under "trip-documents/" before
 * any listing happens, so a bad caller can never trigger a scan (let alone
 * a delete) outside that tree or across ".." segments. Returns the
 * normalized prefix (leading/trailing slashes stripped) on success.
 */
function assertValidStoragePrefix(prefix: string): string {
  if (!prefix || prefix === "/") {
    throw new Error("Invalid storage prefix: must not be empty");
  }
  if (prefix.includes("..") || prefix.includes("//") || /[\x00-\x1f\x7f]/.test(prefix)) {
    throw new Error(`Invalid storage prefix: "${prefix}" contains disallowed characters`);
  }
  if (!prefix.startsWith("trip-documents/")) {
    throw new Error(`Invalid storage prefix: "${prefix}" must start with "trip-documents/"`);
  }

  const normalized = normalizeKey(prefix).replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Invalid storage prefix: "${prefix}" has too few segments`);
  }

  return normalized;
}

/**
 * Recursively deletes every object under `prefix` (a folder path, e.g.
 * "trip-documents/42/"). Supabase Storage's `list` only returns the
 * immediate children of a folder, not a flat prefix match, so folders are
 * walked breadth-first; entries with `id === null` are subfolders.
 */
export async function storageDeletePrefix(prefix: string): Promise<void> {
  const normalizedPrefix = assertValidStoragePrefix(prefix);
  const bucket = getBucket();
  const client = getSupabaseAdmin();

  const folderQueue: string[] = [normalizedPrefix];
  const filePaths: string[] = [];

  while (folderQueue.length > 0) {
    const folder = folderQueue.shift()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: LIST_PAGE_SIZE, offset });

      if (error) {
        throw new Error(`Storage list failed for "${folder}": ${error.message}`);
      }
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const entryPath = `${folder}/${entry.name}`;
        if (entry.id === null) {
          folderQueue.push(entryPath);
        } else {
          filePaths.push(entryPath);
        }
      }

      if (data.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }
  }

  for (let i = 0; i < filePaths.length; i += LIST_PAGE_SIZE) {
    const batch = filePaths.slice(i, i + LIST_PAGE_SIZE);
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Storage delete failed for prefix "${normalizedPrefix}": ${error.message}`);
    }
  }
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
