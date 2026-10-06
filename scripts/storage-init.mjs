import { config } from "dotenv";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("Trūksta S3 konfigūracijos.");
const s3 = new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: true, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
try { await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
catch (error) {
  if (error.$metadata?.httpStatusCode !== 404) throw error;
  await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
}
process.stdout.write(`Privatus saugyklos kibiras paruoštas: ${S3_BUCKET}\n`);
