export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--bg-main)',
        color: 'var(--text-muted)',
        gap: '1.25rem',
      }}
    >
      {/* Spinner */}
      <div
        role="status"
        aria-label="Cargando"
        style={{
          width: '2.75rem',
          height: '2.75rem',
          borderRadius: '9999px',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--cta)',
          animation: 'spin 0.8s linear infinite',
        }}
      />

      {/* Pulse dots */}
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: '0.45rem',
              height: '0.45rem',
              borderRadius: '9999px',
              background: 'var(--cta)',
              opacity: 0.35,
              animation: `pulseDot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      <p
        style={{
          fontSize: '0.875rem',
          fontWeight: 400,
          letterSpacing: '0.02em',
          opacity: 0.7,
        }}
      >
        Cocinando algo especial...
      </p>

      {/* Inline keyframe definitions via style tag — minimal, self-contained */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.75; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
