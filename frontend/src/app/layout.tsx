import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthProvider } from '@/context/AuthContext';
import { Suspense } from 'react';
import HouseholdShell from './components/HouseholdShell';
import './globals.css';

const manrope = localFont({
  src: './fonts/manrope/Manrope-Variable.ttf',
  display: 'swap',
  weight: '200 800',
  variable: '--font-manrope',
  fallback: ['Arial', 'sans-serif'],
});

const fraunces = localFont({
  src: './fonts/fraunces/Fraunces-Variable.ttf',
  display: 'swap',
  weight: '100 900',
  variable: '--font-fraunces',
  fallback: ['Georgia', 'serif'],
});

export const metadata: Metadata = {
  title: 'CocinaCore | Tu cocina más organizada',
  description:
    'Organizá recetas, ingredientes, menús y listas de compras con ayuda inteligente para cocinar en casa.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${manrope.variable} ${fraunces.variable}`}>
      <body>
        <AuthProvider>
          <Suspense fallback={children}>
            <HouseholdShell>{children}</HouseholdShell>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
