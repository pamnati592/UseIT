import { supabase } from './supabase';

export const ITEM_IMAGES_BUCKET = 'item-images';        // public — item galleries, avatars
export const HANDOFF_EVIDENCE_BUCKET = 'handoff-evidence'; // private — condition & dispute photos
export const VERIFICATION_PHOTOS_BUCKET = 'verification-photos'; // private — admin-only (spec 4.7)

// base64 → Uint8Array. fetch() and XHR both hand back 0-byte blobs for Expo file
// URIs on iOS, so the SDK is fed raw bytes instead. This was independently
// rediscovered and duplicated in AddItemScreen, EditItemScreen and ProfileScreen;
// new code should call through here rather than growing a fourth copy.
function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extensionFor(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] ?? 'jpg');
}

/**
 * Uploads an image and returns its **storage path**, not a URL.
 *
 * Paths rather than URLs because `handoff-evidence` is a private bucket: it has no
 * public URL, and a signed one expires. Persist the path, mint a signed URL at
 * display time with `signedUrlFor`.
 */
export async function uploadImage(
  bucket: string,
  path: string,
  asset: { base64: string; mimeType: string },
): Promise<string> {
  const fileName = `${path}.${extensionFor(asset.mimeType)}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(fileName, toBytes(asset.base64), { contentType: asset.mimeType });
  if (error) throw error;
  return fileName;
}

/** Signed read URL for a private-bucket object. Returns null if the caller can't read it. */
export async function signedUrlFor(
  bucket: string,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Storage path for a handoff condition photo. The first segment must be the
 * transaction id — every RLS policy on this bucket keys off it to decide whether
 * the caller is a party to that rental.
 */
export function handoffPhotoPath(transactionId: string, phase: 'pickup' | 'return'): string {
  return `${transactionId}/${phase}-${Date.now()}`;
}

/** Same, for the photo attached to a dispute. */
export function disputePhotoPath(transactionId: string): string {
  return `${transactionId}/dispute-${Date.now()}`;
}
