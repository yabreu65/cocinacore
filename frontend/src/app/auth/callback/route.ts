import { NextResponse } from 'next/server';

export async function GET() {
  // OAuth callbacks are intentionally disabled in this migration phase.
  // Only email/password authentication is supported.
  return NextResponse.redirect(new URL('/login?error=oauth_disabled', 'http://localhost:3000'));
}
