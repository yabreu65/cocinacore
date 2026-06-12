import { type NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  await revokeSession(request, response);
  return response;
}
