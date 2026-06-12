import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      className="texture-paper"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--bg-main)',
        color: 'var(--text-main)',
      }}
    >
      <div
        className="glass-soft premium-shadow"
        style={{
          maxWidth: '28rem',
          width: '100%',
          borderRadius: '1rem',
          padding: '2.5rem 2rem',
          textAlign: 'center',
        }}
      >
        {/* 404 icon */}
        <div
          style={{
            fontSize: '3.5rem',
            fontFamily: 'var(--font-playfair), serif',
            fontWeight: 700,
            color: 'var(--cta)',
            lineHeight: 1,
            marginBottom: '0.75rem',
          }}
          aria-hidden="true"
        >
          404
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontSize: '1.5rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
          }}
        >
          Página no encontrada
        </h1>

        <p
          style={{
            fontSize: '0.925rem',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            marginBottom: '1.75rem',
          }}
        >
          La página que buscás no existe o fue movida.
        </p>

        <Link
          href="/app"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.625rem 1.5rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: 'var(--cta)',
            color: '#fff',
            fontWeight: 500,
            fontSize: '0.9rem',
            textDecoration: 'none',
            transition: 'background 0.2s',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          Ir al recetario
        </Link>
      </div>
    </div>
  );
}
