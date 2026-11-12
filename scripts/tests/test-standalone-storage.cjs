// Run only against the explicitly disposable standalone storage project.
if (process.env.CC_STANDALONE_DISPOSABLE_TEST !== "true")
  throw Error("Explicit disposable test flag required");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const bucket = "cocinacore-documents",
  key = "global-pdfs/f54b-synthetic.pdf",
  privateKey = "tenant-pdfs/synthetic-other/fixture.pdf";
const c = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  maxAttempts: 1,
});
function pdf() {
  const stream = "BT /F1 12 Tf 20 100 Td (CocinaCore synthetic PDF) Tj ET\n";
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets = [0];
  parts.forEach((part, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${part}\nendobj\n`;
  });
  const x = Buffer.byteLength(data);
  data +=
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(data);
}
async function denied(label, command) {
  try {
    await c.send(command);
    assert.fail(label + " unexpectedly allowed");
  } catch (e) {
    assert.equal(e.$metadata?.httpStatusCode, 403, label + " expected 403");
    console.log(label + " HTTP 403");
  }
}
async function main() {
  assert.equal(process.env.S3_ENDPOINT, "http://storage:9000");
  assert.equal(process.env.S3_BUCKET, bucket);
  assert.equal(process.env.S3_ACCESS_KEY_ID, "cocinacore-app");
  assert.ok(!process.env.RUSTFS_SECRET_KEY);
  const body = pdf();
  assert.ok(
    ["write", "read"].includes(process.argv[2]),
    "Explicit write/read phase required",
  );
  if (process.argv[2] === "write") {
    await c.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/pdf",
      }),
    );
    console.log("GLOBAL_PDF_PUT PASS");
  }
  const o = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.equal(o.ContentType, "application/pdf");
  assert.deepEqual(Buffer.from(await o.Body.transformToByteArray()), body);
  console.log(
    "GLOBAL_PDF_READBACK_SHA256 " +
      crypto.createHash("sha256").update(body).digest("hex"),
  );
  const l = await c.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "global-pdfs/" }),
  );
  assert.ok(l.Contents.some((x) => x.Key === key));
  console.log("GLOBAL_LIST PASS");
  await denied("UNSCOPED_LIST", new ListObjectsV2Command({ Bucket: bucket }));
  await denied(
    "PRIVATE_LIST",
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "tenant-pdfs/" }),
  );
  await denied(
    "PRIVATE_GET",
    new GetObjectCommand({ Bucket: bucket, Key: privateKey }),
  );
  await denied(
    "PRIVATE_PUT",
    new PutObjectCommand({
      Bucket: bucket,
      Key: privateKey,
      Body: body,
      ContentType: "application/pdf",
    }),
  );
  const anon = await fetch(process.env.S3_ENDPOINT + "/" + bucket + "/" + key);
  assert.equal(anon.status, 403);
  console.log("ANONYMOUS_GLOBAL_PDF_GET HTTP 403");
}
main()
  .catch((e) => {
    console.error("FAIL " + e.name + " " + e.message.slice(0, 160));
    process.exitCode = 1;
  })
  .finally(() => c.destroy());
