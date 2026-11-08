/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only 019 inert attestation. This is not a post-020 activation contract.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ATTESTATION_SHA256 = '507b9ca9cec49d68cd29b07c5d10bf4f34e1db9b71740f85f1a7bf69cf1e772b';

function loadInertAttestation() {
  const sql = fs.readFileSync(path.join(__dirname, 'prepared-capabilities-attestation.sql'));
  if (crypto.createHash('sha256').update(sql).digest('hex') !== ATTESTATION_SHA256) {
    throw new Error('PREPARED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted attestation SQL.');
  }
  return sql.toString('utf8');
}

async function attestPreparedCapabilities(client, { required = false } = {}) {
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN (
         'runtime_identity_probe','owner_metrics_rls_guard','owner_global_metrics',
         'owner_write_global_books','owner_write_global_pdfs','owner_write_global_chunks')) +
      (SELECT count(*) FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='signup_new_account') AS count
  `);
  const count = Number(result.rows[0].count);
  if (count === 0 && !required) return 'unprepared';
  if (count !== 7) {
    throw new Error('PREPARED_CAPABILITIES_PARTIAL: seven inert objects are required.');
  }
  try {
    await client.query(loadInertAttestation());
  } catch (error) {
    throw new Error(`PREPARED_CAPABILITIES_MISMATCH: ${error.message}`);
  }
  return 'inert';
}

module.exports = { attestPreparedCapabilities, loadInertAttestation };
