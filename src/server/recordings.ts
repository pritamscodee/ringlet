import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Call recordings live in S3. The browser uploads straight to the bucket with
 * a presigned URL, so audio never passes through a function (Lambda request
 * bodies are capped at 6 MB). Without RECORDINGS_BUCKET, recording is off.
 */
const bucket = process.env.RECORDINGS_BUCKET;
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({}));

export function recordingsEnabled() {
  return !!bucket;
}

export function recordingKey(workspaceId: string, conversationId: string) {
  return `recordings/${workspaceId}/${conversationId}.webm`;
}

export function uploadUrl(key: string, contentType: string) {
  if (!bucket) throw new Error("RECORDINGS_BUCKET is not set");
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: 600,
  });
}

export function downloadUrl(key: string) {
  if (!bucket) return Promise.resolve(null);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
}

export async function deleteRecording(key: string) {
  if (!bucket) return;
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
