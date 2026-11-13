/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only PG16 contracts for the exact 020 and 021 capability states.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACTIVATION_ATTESTATION_SHA256 =
  '62e96281227b57c71e00879a2b019cf57beaa3e376e775c0a4d574dde38ab841';

const INVENTORY_021_ATTESTATION_SHA256 =
  '637be0a5b5c875f1f74d9088843fe2442024984e8f8d24365997301575072631';

function loadActivationAttestation(version = '020') {
  if (version !== '020' && version !== '021') {
    throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: unsupported catalog version.');
  }
  const filename = version === '021'
    ? 'activated-capabilities-021-attestation.sql'
    : 'activated-capabilities-attestation.sql';
  const expectedHash = version === '021' ? INVENTORY_021_ATTESTATION_SHA256 : ACTIVATION_ATTESTATION_SHA256;
  const sql = fs.readFileSync(path.join(__dirname, filename));
  if (crypto.createHash('sha256').update(sql).digest('hex') !== expectedHash) {
    throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted attestation SQL.');
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
  if (version === '021' && state !== 'active') {
    throw new Error('ACTIVATED_CAPABILITIES_MISMATCH: ACTIVATION_PENDING: 021 requires active 020 capabilities.');
  }
  return state;
}

module.exports = { attestActivatedCapabilities, loadActivationAttestation };
