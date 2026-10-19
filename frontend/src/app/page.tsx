import Link from 'next/link';
import LandingPage from './components/LandingPage';

export default function Page() {
  return (
    <>
      <LandingPage />
      <div className="texture-paper bg-[#FAF6F1] px-4 pb-6 text-center">
        <Link href="/recipes" className="font-semibold text-[#8C4712] underline">
          Abrir mi recetario
        </Link>
      </div>
    </>
  );
}
