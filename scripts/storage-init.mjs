import { config } from "dotenv";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
const { S3_BUCKET } = process.env;
const useAws = Boolean(process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY);
const endpoint = useAws ? process.env.AWS_ENDPOINT_URL_S3 : process.env.S3_ENDPOINT;
const region = useAws ? process.env.AWS_REGION : process.env.S3_REGION;
const accessKeyId = useAws ? process.env.AWS_ACCESS_KEY_ID : process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = useAws ? process.env.AWS_SECRET_ACCESS_KEY : process.env.S3_SECRET_ACCESS_KEY;
if (!endpoint || !region || !S3_BUCKET || !accessKeyId || !secretAccessKey) throw new Error("Trūksta S3 konfigūracijos.");
const s3 = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
try { await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
catch (error) {
  if (error.$metadata?.httpStatusCode !== 404) throw error;
  if (useAws) throw new Error("Neon bucket nerastas. Sukurk privatų bucket Neon valdymo skydelyje.");
  await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
}
process.stdout.write(`Privatus saugyklos kibiras paruoštas: ${S3_BUCKET}\n`);
