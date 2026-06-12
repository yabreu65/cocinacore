'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to error reporting service in production
    console.error('[GlobalError]', error);
  }, [error]);

  const isProduction = process.env.NODE_ENV === 'production';

  return (
    <div
      className="texture-paper"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--bg-dark)',
        color: 'var(--bg-main)',
      }}
    >
      <div
        className="glass-soft dark-panel-shadow"
        style={{
          maxWidth: '28rem',
          width: '100%',
          borderRadius: '1rem',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          background: 'rgba(22, 17, 13, 0.85)',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: '3.5rem',
            height: '3.5rem',
            borderRadius: '9999px',
            background: 'rgba(197, 106, 26, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
          }}
          aria-hidden="true"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--cta)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontSize: '1.5rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
            color: 'var(--bg-main)',
          }}
        >
          Algo salió mal
        </h1>

        <p
          style={{
            fontSize: '0.925rem',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            marginBottom: '0.75rem',
          }}
        >
          {isProduction
            ? 'Ocurrió un error inesperado. Por favor intentá de nuevo.'
            : error.message || 'Ocurrió un error inesperado.'}
        </p>

        {!isProduction && error.digest && (
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              marginBottom: '1.25rem',
              opacity: 0.6,
            }}
          >
            digest: {error.digest}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => reset()}
            style={{
              padding: '0.625rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: 'var(--cta)',
              color: '#fff',
              fontWeight: 500,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--cta-hover)';
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--cta)';
            }}
          >
            Reintentar
          </button>

          <Link
            href="/app"
            style={{
              padding: '0.625rem 1.5rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontWeight: 500,
              fontSize: '0.9rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              transition: 'border-color 0.2s, color 0.2s',
            }}
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
