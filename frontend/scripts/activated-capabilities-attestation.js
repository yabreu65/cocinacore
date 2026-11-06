/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only PG16 contract for the exact post-020 capability state.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACTIVATION_ATTESTATION_SHA256 =
  '62e96281227b57c71e00879a2b019cf57beaa3e376e775c0a4d574dde38ab841';

function loadActivationAttestation() {
  const sql = fs.readFileSync(path.join(__dirname, 'activated-capabilities-attestation.sql'));
  if (crypto.createHash('sha256').update(sql).digest('hex') !== ACTIVATION_ATTESTATION_SHA256) {
    throw new Error('ACTIVATED_CAPABILITIES_ATTESTATION_MISMATCH: untrusted attestation SQL.');
  }
  return sql.toString('utf8');
}

async function attestActivatedCapabilities(client) {
  let result;
  try {
    result = await client.query(loadActivationAttestation());
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
  return state;
}

module.exports = { attestActivatedCapabilities, loadActivationAttestation };
