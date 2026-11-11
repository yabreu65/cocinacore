import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthProvider } from '@/context/AuthContext';
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
  title: 'CocinaCore | Recetario familiar inteligente',
  description:
    'SaaS premium para recetas personalizadas, biblioteca PDF e inventario culinario familiar.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${manrope.variable} ${fraunces.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
