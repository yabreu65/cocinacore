'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw, Server, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types (mirrors the /api/health response shape)
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'fail' | 'timeout' | 'not_configured';

interface SingleCheck {
  status: CheckStatus;
  latency: number;
}

interface HealthData {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    postgresql: SingleCheck;
    redis: SingleCheck;
    gemini: SingleCheck;
  };
}

// ---------------------------------------------------------------------------
// Subsystem definition (icon + label)
// ---------------------------------------------------------------------------

interface SubsystemDef {
  key: keyof HealthData['checks'];
  label: string;
  icon: React.ReactNode;
}

const SUBSYSTEMS: SubsystemDef[] = [
  { key: 'postgresql', label: 'PostgreSQL', icon: <Database size={18} /> },
  { key: 'redis', label: 'Redis', icon: <Server size={18} /> },
  { key: 'gemini', label: 'Gemini', icon: <Sparkles size={18} /> },
];

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  CheckStatus,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  ok: {
    bg: 'bg-bistro-action-secondary/10',
    border: 'border-bistro-action-secondary/30',
    text: 'text-bistro-action-secondary',
    dot: 'bg-bistro-action-secondary',
    label: 'Operativo',
  },
  timeout: {
    bg: 'bg-bistro-action-primary/10',
    border: 'border-bistro-action-primary/30',
    text: 'text-bistro-action-primary',
    dot: 'bg-bistro-action-primary',
    label: 'Timeout',
  },
  not_configured: {
    bg: 'bg-bistro-surface-warm/10',
    border: 'border-bistro-border/20',
    text: 'text-bistro-text-secondary',
    dot: 'bg-bistro-surface-warm',
    label: 'Not configured',
  },
  fail: {
    bg: 'bg-bistro-danger/10',
    border: 'border-bistro-danger/30',
    text: 'text-bistro-danger',
    dot: 'bg-bistro-danger',
    label: 'Caído',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OwnerSystemHealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    // Don't set loading=true on refresh to avoid UI flicker
    setFetchError(null);

    try {
      const response = await fetch('/api/owner/health');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as HealthData;
      setHealth(data);
      setLastUpdated(new Date());

      if (data.status === 'degraded') {
        console.warn('[health.dashboard_degraded]', {
          failedChecks: Object.entries(data.checks)
            .filter(([, c]) => c.status !== 'ok')
            .map(([k]) => k),
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error desconocido al obtener estado del sistema.';
      setFetchError(msg);
      console.error('[health.dashboard_fetch_failed]', {
        error: msg,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + 30s polling
  useEffect(() => {
    void fetchHealth();

    const interval = setInterval(() => {
      void fetchHealth();
    }, 30_000);

    return () => clearInterval(interval);
  }, [fetchHealth]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderStatusCard(sub: SubsystemDef) {
    const check = health?.checks[sub.key];
    const status = check?.status ?? 'fail';
    const config = STATUS_CONFIG[status];

    return (
      <article
        key={sub.key}
        data-testid="status-card"
        className={`rounded-2xl border p-4 premium-shadow transition ${config.border} ${config.bg}`}
      >
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`${config.text}`}>{sub.icon}</span>
            <h3 className="text-sm font-semibold text-bistro-text-primary">{sub.label}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dot}`} />
            <span className={`text-xs font-semibold ${config.text}`}>{config.label}</span>
          </div>
        </header>

        <div className="mt-3 space-y-1 text-xs text-bistro-text-secondary">
          {check ? (
            <>
              <p>
                Latencia:{' '}
                <span className="font-semibold text-bistro-text-primary">{check.latency}ms</span>
              </p>
            </>
          ) : (
            <p>Sin datos</p>
          )}
        </div>
      </article>
    );
  }

  function renderOverallBanner() {
    if (!health) return null;

    const isOk = health.status === 'ok';
    return (
      <article
        className={`mb-5 rounded-3xl border p-4 premium-shadow ${
          isOk
            ? 'border-bistro-action-secondary/30 bg-bistro-action-secondary/10'
            : 'border-bistro-action-primary/30 bg-bistro-action-primary/10'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                isOk ? 'bg-bistro-action-secondary' : 'bg-bistro-action-primary'
              }`}
            />
            <p className="text-sm font-semibold text-bistro-text-primary">
              Estado global:{' '}
              <span
                className={isOk ? 'text-bistro-action-secondary' : 'text-bistro-action-primary'}
              >
                {isOk ? 'Todo operativo' : 'Degradado'}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-bistro-text-secondary">
              v{health.version}{' '}
              {lastUpdated ? `· Actualizado ${lastUpdated.toLocaleTimeString()}` : ''}
            </p>
          </div>
        </div>
      </article>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <section className="space-y-4">
      {/* Header */}
      <article className="rounded-3xl border border-bistro-border bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-bistro-action-secondary/25 bg-bistro-action-secondary/10 px-3 py-1 text-xs font-semibold text-bistro-action-secondary">
          <ActivityIcon size={14} /> Monitoreo en tiempo real
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-bistro-text-primary">System Health</h1>
        <p className="mt-1 text-sm text-bistro-text-secondary">
          Estado operativo de todos los subsistemas. Se actualiza automáticamente cada 30 segundos.
        </p>
      </article>

      {/* Overall banner */}
      {renderOverallBanner()}

      {/* Error banner */}
      {fetchError ? (
        <article className="rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-4 py-3">
          <p className="text-sm text-bistro-danger">{fetchError}</p>
        </article>
      ) : null}

      {/* Loading state (only on initial load) */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {SUBSYSTEMS.map((sub) => (
            <article
              key={sub.key}
              className="rounded-2xl border border-bistro-border bg-white/60 p-5 premium-shadow animate-pulse"
            >
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded bg-bistro-border" />
                <div className="h-4 w-24 rounded bg-bistro-border" />
              </div>
              <div className="mt-3 h-4 w-32 rounded bg-bistro-border" />
            </article>
          ))}
        </div>
      ) : health ? (
        <>
          {/* Status grid */}
          <div className="grid gap-3 sm:grid-cols-2">{SUBSYSTEMS.map(renderStatusCard)}</div>

          {/* Timestamp + refresh info */}
          <footer className="flex items-center justify-between rounded-2xl border border-bistro-border bg-white/70 px-4 py-3">
            <p className="text-xs text-bistro-text-secondary">
              {health.timestamp
                ? `Último chequeo: ${new Date(health.timestamp).toLocaleString()}`
                : 'Sin datos de timestamp'}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                void fetchHealth();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-bistro-border bg-white px-3 py-1.5 text-xs font-semibold text-bistro-text-secondary transition hover:border-bistro-action-primary/40 hover:text-bistro-action-primary"
            >
              <RefreshCw size={14} /> Refrescar ahora
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}

/** Small inline SVG icon to avoid an extra lucide import just for one icon */
function ActivityIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
