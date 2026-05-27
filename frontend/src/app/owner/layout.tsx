import { ReactNode } from 'react';
import OwnerShell from './OwnerShell';

type OwnerLayoutProps = {
  children: ReactNode;
};

export default function OwnerLayout({ children }: OwnerLayoutProps) {
  return <OwnerShell>{children}</OwnerShell>;
}
