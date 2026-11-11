import Link from 'next/link';
import LandingPage from './components/LandingPage';

export default function Page() {
  return (
    <>
      <LandingPage />
      <div className="texture-paper bg-bistro-page px-4 pb-6 text-center">
        <Link href="/login" className="font-semibold text-bistro-action-primary underline">
          ¿Ya tenés una cuenta? Iniciá sesión
        </Link>
      </div>
    </>
  );
}
