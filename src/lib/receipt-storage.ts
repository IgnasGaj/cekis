import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getStorageEnv } from "./env";

let client: S3Client | undefined;
function storage() {
  const config = getStorageEnv();
  client ??= new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 2 });
  return { client, bucket: config.bucket };
}
export async function readObject(key: string): Promise<Buffer | null> {
  const { client, bucket } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
    if (!result.Body || (result.ContentLength ?? 0) > 10485760) throw new Error("Netinkamas saugyklos atsakymas");
    const chunks: Buffer[] = []; let total = 0;
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      total += part.length;
      if (total > 10485760) throw new Error("Netinkamas saugyklos atsakymas");
      chunks.push(Buffer.from(part));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && (error.name === "NoSuchKey" || error.name === "NotFound")) return null;
    throw error;
  }
}
export async function putOriginal(key: string, bytes: Buffer, contentType: string, hash: string) {
  const { client, bucket } = storage();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(30000) });
  } catch (error) {
    if (!(error && typeof error === "object" && "$metadata" in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)) throw error;
    const existing = await readObject(key);
    if (!existing || createHash("sha256").update(existing).digest("hex") !== hash) throw new Error("Saugyklos objektas nesutampa");
  }
}
export async function deleteObject(key: string) {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
}
