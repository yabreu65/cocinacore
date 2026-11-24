#!/usr/bin/env node
// Static least-privilege contract; never accesses RustFS or credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const policyFile = path.join(root, 'scripts/standalone-tenant-pdf-policy.json');
const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
assert.deepEqual(policy, {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: ['s3:PutObject', 's3:DeleteObject'],
    Resource: ['arn:aws:s3:::cocinacore-tenant-pdfs/tenant-pdfs/*'],
  }],
});
const adapter = fs.readFileSync(path.join(root, 'frontend/src/lib/storage/tenantPdfStorage.ts'), 'utf8');
assert.match(adapter, /requiredEnv\('S3_TENANT_BUCKET'\)/);
assert.match(adapter, /requiredEnv\('S3_TENANT_ACCESS_KEY_ID'\)/);
assert.match(adapter, /requiredEnv\('S3_TENANT_SECRET_ACCESS_KEY'\)/);
assert.match(adapter, /bucket === process\.env\.S3_BUCKET/);
assert.match(adapter, /accessKeyId === process\.env\.S3_ACCESS_KEY_ID/);
assert.match(adapter, /tenant-pdfs\/\$\{tenantId\}/);
console.log('PASS tenant PDF IAM policy: put/delete only, dedicated bucket/prefix; adapter separate credentials and strict tenant namespace');
