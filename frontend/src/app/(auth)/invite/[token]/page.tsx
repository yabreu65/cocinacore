import Link from 'next/link';

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-10 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-[#E8DDD2] bg-white/85 p-6 premium-shadow">
        <h1 className="text-3xl font-semibold">Unirte al tenant</h1>
        <p className="mt-2 text-sm text-[#6B5A50]">
          Funcionalidad en reconstrucción mientras migramos invitaciones a PostgreSQL directo.
        </p>

        <div className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 text-sm text-[#6B5A50]">
          <p className="font-semibold text-[#241A14]">Token recibido</p>
          <p className="mt-1 break-all">{token}</p>
          <p className="mt-3">
            Conservá este enlace y pedí a un owner/admin que vuelva a emitir la invitación cuando
            terminemos la migración.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[#C56A1A] px-4 font-semibold text-white"
          >
            Ir a login
          </Link>
          <Link
            href="/members"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#E8DDD2] px-4 font-semibold text-[#6B5A50]"
          >
            Ver miembros
          </Link>
        </div>
      </section>
    </main>
  );
}
