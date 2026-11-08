// Static 020E-A1-P manifest declaration only. Database attestation and activation
// integration are not implemented by this module and must not be inferred from it.
const PREPARED_CAPABILITIES_CONTRACT = {
  version: 1,
  requiredBefore: '020',
  state: 'inert',
  acl: 'owner-only',
  objects: [
    {
      kind: 'view',
      identity: 'public.runtime_identity_probe',
      owner: 'cocinacore_identity_probe',
      definitionMd5: '8488958e031f004f834e064a4d2f8019',
      options: ['security_barrier=true'],
    },
    {
      kind: 'function',
      identity: 'public.signup_new_account(text,text,text,timestamptz,text)',
      owner: 'cocinacore_signup_bootstrap',
      definitionMd5: '5358b46b5b10a8878408f2ffa5a2f223',
      options: ['security_definer', 'search_path=pg_catalog'],
    },
    {
      kind: 'view',
      identity: 'public.owner_metrics_rls_guard',
      owner: 'cocinacore_metrics_view_owner',
      definitionMd5: '8da147bc319c202a2ee4c8401c3d93ae',
      options: [],
    },
    {
      kind: 'view',
      identity: 'public.owner_global_metrics',
      owner: 'cocinacore_metrics_view_owner',
      definitionMd5: '59035b254a488a1015d641a81cc928ff',
      options: [],
    },
    {
      kind: 'view',
      identity: 'public.owner_write_global_books',
      owner: 'cocinacore_global_writer_view_owner',
      definitionMd5: '158e764a6af66977e575135a28ea2b2c',
      options: [],
    },
    {
      kind: 'view',
      identity: 'public.owner_write_global_pdfs',
      owner: 'cocinacore_global_writer_view_owner',
      definitionMd5: '6faa61bf38a8fb2510439274c2df9e49',
      options: [],
    },
    {
      kind: 'view',
      identity: 'public.owner_write_global_chunks',
      owner: 'cocinacore_global_writer_view_owner',
      definitionMd5: '0bd8cd5e0a83eb114d2306b6dd0af4df',
      options: ['check_option=cascaded'],
    },
  ],
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function assertPreparedCapabilitiesManifest(value) {
  if (
    JSON.stringify(canonical(value)) !== JSON.stringify(canonical(PREPARED_CAPABILITIES_CONTRACT))
  ) {
    throw new Error(
      'PREPARED_CAPABILITIES_MANIFEST_MISMATCH: untrusted independent-object declaration.'
    );
  }
}

module.exports = { PREPARED_CAPABILITIES_CONTRACT, assertPreparedCapabilitiesManifest };
