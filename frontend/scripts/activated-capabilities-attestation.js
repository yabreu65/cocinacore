/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only PG16 contracts for the exact 020 and 021 capability states.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACTIVATION_ATTESTATION_SHA256 =
  '62e96281227b57c71e00879a2b019cf57beaa3e376e775c0a4d574dde38ab841';

const INVENTORY_021_ATTESTATION_SHA256 =
  '637be0a5b5c875f1f74d9088843fe2442024984e8f8d24365997301575072631';

const OCCURRENCE_022_ATTESTATION_SHA256 = '1e21e5bc69286f9b5230f0c323ad89dbbbf35c3c0bcac1d0f519f5776d34391f';

const RETENTION_023_ATTESTATION_SHA256 = '6ce4c11587c78500e8e2b8ba5ecb51bf0151625165c4b7badc606925f0946ddf';
const FIRST_ADMIN_024_ATTESTATION_SHA256 = '096240c8246b34f33599dfcdaaa8ee919b2b225968b6114d1f9e0f08bcfef87f';
const FIRST_ADMIN_024_INVENTORY_ATTESTATION_SHA256 = 'a4de388c8f60fd4bc735bf75ed6f70ff249bb8aa2a246615114aaceab4623771';

const PRIVATE_PDF_025_INVENTORY_ATTESTATION_SHA256 = '71793cce59481043e7fe53a067b9c59768e8d0dd3b988d588cde12fd778fe455';

function loadActivationAttestation(version = '020') {
  if (!['020','021','022','023','024','025'].includes(version)) {
    throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: unsupported catalog version.');
  }
  const filename = version !== '020'
    ? 'activated-capabilities-021-attestation.sql'
    : 'activated-capabilities-attestation.sql';
  const expectedHash = version !== '020' ? INVENTORY_021_ATTESTATION_SHA256 : ACTIVATION_ATTESTATION_SHA256;
  const sql = fs.readFileSync(path.join(__dirname, filename));
  if (crypto.createHash('sha256').update(sql).digest('hex') !== expectedHash) {
    throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted attestation SQL.');
  }
  if (version === '023') {
    const extra = fs.readFileSync(path.join(__dirname, 'activated-capabilities-023-retention.sql'));
    if (crypto.createHash('sha256').update(extra).digest('hex') !== RETENTION_023_ATTESTATION_SHA256) throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted 023 attestation SQL.');
    return extra.toString('utf8') + '\n' + loadActivationAttestation('022');
  }
  if (version === '024' || version === '025') {
    const extra = fs.readFileSync(path.join(__dirname, 'activated-capabilities-024-first-admin.sql'));
    if (crypto.createHash('sha256').update(extra).digest('hex') !== FIRST_ADMIN_024_ATTESTATION_SHA256) throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted 024 attestation SQL.');
    const files = [
      ['activated-capabilities-023-retention.sql', RETENTION_023_ATTESTATION_SHA256],
      ['activated-capabilities-022-occurrences.sql', OCCURRENCE_022_ATTESTATION_SHA256],
      version === '025'
        ? ['activated-capabilities-025-inventory.sql', PRIVATE_PDF_025_INVENTORY_ATTESTATION_SHA256]
        : ['activated-capabilities-024-inventory.sql', FIRST_ADMIN_024_INVENTORY_ATTESTATION_SHA256],
    ];
    const trustedSql = files.map(([filename, expected]) => {
      const sql = fs.readFileSync(path.join(__dirname, filename));
      if (crypto.createHash('sha256').update(sql).digest('hex') !== expected) {
        throw new Error(`ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted ${filename}.`);
      }
      return sql.toString('utf8');
    });
    return [extra.toString('utf8'), ...trustedSql].join('\n');
  }
  if (version === '022') {
    const extra = fs.readFileSync(path.join(__dirname, 'activated-capabilities-022-occurrences.sql'));
    if (crypto.createHash('sha256').update(extra).digest('hex') !== OCCURRENCE_022_ATTESTATION_SHA256) throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted 022 attestation SQL.');
    return extra.toString('utf8') + '\n' + sql.toString('utf8');
  }
  return sql.toString('utf8');
}

async function attestActivatedCapabilities(client, version = '020') {
  let result;
  try {
    result = await client.query(loadActivationAttestation(version));
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 400);
    const position = error && error.position ? ` at SQL position ${error.position}` : '';
    throw new Error(`ACTIVATED_CAPABILITIES_MISMATCH: ${message}${position}`);
  }
  const finalResult = Array.isArray(result) ? result.at(-1) : result;
  const state = finalResult && finalResult.rows ? finalResult.rows[0]?.activation_state : undefined;
  if (state !== 'active' && state !== 'pending') {
    throw new Error('ACTIVATED_CAPABILITIES_MISMATCH: invalid activation state result.');
  }
  if (version !== '020' && state !== 'active') {
    throw new Error('ACTIVATED_CAPABILITIES_MISMATCH: ACTIVATION_PENDING: post-020 migrations require active 020 capabilities.');
  }
  return state;
}

module.exports = { attestActivatedCapabilities, loadActivationAttestation };
