import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { updateUser } from '@/lib/db/repositories/userRepository';
import {
  findCulinaryProfileByUserId,
  upsertCulinaryProfile,
} from '@/lib/db/repositories/culinaryProfileRepository';

export async function GET() {
  const user = await requireUser();
  const profile = await findCulinaryProfileByUserId(user.id);
  return NextResponse.json({ user, profile });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  const body: unknown = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { fullName, level } = body as { fullName?: string; level?: string };

  const updatedUser = await updateUser(user.id, {
    fullName: fullName?.trim() || null,
  });

  if (user.tenant) {
    await upsertCulinaryProfile({
      userId: user.id,
      tenantId: user.tenant.tenantId,
      level: level?.trim() || null,
    });
  }

  return NextResponse.json({ user: updatedUser });
}
