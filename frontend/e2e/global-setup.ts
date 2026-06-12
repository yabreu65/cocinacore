import { execSync } from 'child_process';
import path from 'path';

export default async function globalSetup() {
  const rootDir = path.resolve(__dirname, '../..');

  // Start Supabase local stack
  console.log('Starting Supabase local stack...');
  execSync('supabase start', { cwd: rootDir, stdio: 'inherit' });
}
