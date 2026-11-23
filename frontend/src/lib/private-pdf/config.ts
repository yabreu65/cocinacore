/** Private S3 must never inherit the global bucket or identity. */
export function privatePdfStorageConfigured(): boolean {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || 'local';
  if (driver === 'local') return true;
  if (driver !== 's3') return false;
  const names = ['S3_TENANT_BUCKET', 'S3_TENANT_ACCESS_KEY_ID', 'S3_TENANT_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION'];
  if (names.some((name) => !process.env[name]?.trim() || process.env[name]?.trim() === 'CHANGE_ME')) return false;
  return process.env.S3_TENANT_BUCKET?.trim() !== process.env.S3_BUCKET?.trim() &&
    process.env.S3_TENANT_ACCESS_KEY_ID?.trim() !== process.env.S3_ACCESS_KEY_ID?.trim();
}
