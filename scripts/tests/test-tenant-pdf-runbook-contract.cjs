#!/usr/bin/env node
// Static documentation sanity checks only: no credentials or infrastructure.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const doc = fs.readFileSync(path.join(root, 'docs/ops/tenant-pdf-iam-manual-runbook.md'), 'utf8');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/standalone-tenant-pdf-policy.json'), 'utf8'));

for (const required of [
  /HUMAN OPERATOR STEPS ONLY/,
  /current recoverable backup/i,
  /November 19 backup is old/,
  /do not bypass a security block/i,
  /failed or ambiguous inspection is NOT evidence of absence/i,
  /unexpected policy content, attachments, group membership, status or permissions.*stop/i,
  /standalone-init-storage\.sh.*global/i,
  /standalone-tenant-pdf-policy\.json/,
  /PUT and DELETE succeed/i,
  /Before deleting the test object, verify GET on it and bucket LIST are denied/i,
  /PUT outside the prefix and access to the global bucket are denied/i,
  /successful authentication separately/i,
  /application authorization must do that/i,
  /active 024 capabilities/i,
  /025_private_tenant_pdf_creation\.sql/,
  /do \*\*not\*\* prove live RustFS permissions/i,
]) assert.match(doc, required);
for (const name of ['STORAGE_DRIVER', 'S3_TENANT_BUCKET', 'S3_TENANT_ACCESS_KEY_ID',
  'S3_TENANT_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'CC_APP_ENV']) {
  assert.ok(doc.includes(`\`${name}`), `Missing ${name}`);
}
assert.deepEqual(policy.Statement[0].Action, ['s3:PutObject', 's3:DeleteObject']);
assert.deepEqual(policy.Statement[0].Resource, ['arn:aws:s3:::cocinacore-tenant-pdfs/tenant-pdfs/*']);
assert.doesNotMatch(doc, /\b(?:docker|rc admin|curl|ssh)\s+\S/);
console.log('PASS tenant PDF runbook static sanity checks (no live infrastructure tested)');
