import { type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';
import OwnerShell from './OwnerShell';

type OwnerLayoutProps = {
  children: ReactNode;
};

export default async function OwnerLayout({ children }: OwnerLayoutProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  if (!(await isPlatformOwner(user.id))) {
    redirect('/app');
  }

  return <OwnerShell>{children}</OwnerShell>;
}
