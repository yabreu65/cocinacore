'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, HardDrive, RefreshCw, Server, Sparkles } from 'lucide-react';
import { loadStorageHealth, summarizeHealth, type StorageHealth } from './storage-health';

// ---------------------------------------------------------------------------
// Types (mirrors the existing owner health response shape)
// ---------------------------------------------------------------------------

type CheckStatus = 'ok' | 'fail' | 'timeout' | 'not_configured' | 'degraded' | 'unknown';

interface SingleCheck {
  status: CheckStatus;
  latency: number | null;
}

interface HealthData {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    postgresql: SingleCheck;
    redis: SingleCheck;
    gemini: SingleCheck;
    storage: StorageHealth;
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
  { key: 'storage', label: 'Almacenamiento S3 (RustFS)', icon: <HardDrive size={18} /> },
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
    label: 'Tiempo de espera agotado',
  },
  not_configured: {
    bg: 'bg-bistro-surface-warm/10',
    border: 'border-bistro-border/20',
    text: 'text-bistro-text-secondary',
    dot: 'bg-bistro-surface-warm',
    label: 'No configurado',
  },
  unknown: {
    bg: 'bg-bistro-surface-warm/10',
    border: 'border-bistro-border',
    text: 'text-bistro-text-secondary',
    dot: 'bg-bistro-border',
    label: 'Sin datos',
  },
  degraded: {
    bg: 'bg-bistro-warning/10',
    border: 'border-bistro-warning/30',
    text: 'text-bistro-warning',
    dot: 'bg-bistro-warning',
    label: 'Degradado',
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

  const requestInFlight = useRef(false);

  const fetchHealth = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    // Don't set loading=true on refresh to avoid UI flicker
    setFetchError(null);

    try {
      const [response, storage] = await Promise.all([
        fetch('/api/owner/health'),
        loadStorageHealth(),
      ]);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const ownerHealth = (await response.json()) as Omit<HealthData, 'checks'> & {
        checks: Omit<HealthData['checks'], 'storage'>;
      };
      const data: HealthData = { ...ownerHealth, checks: { ...ownerHealth.checks, storage } };
      setHealth(data);
      setLastUpdated(new Date());

      if (summarizeHealth(data.status, storage) === 'degraded') {
        console.warn('[health.dashboard_degraded]', {
          failedChecks: Object.entries(data.checks)
            .filter(([, c]) => c.status !== 'ok')
            .map(([k]) => k),
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error desconocido al obtener estado del sistema.';
      setHealth(null);
      setFetchError(msg);
      console.error('[health.dashboard_fetch_failed]', {
        error: msg,
      });
    } finally {
      requestInFlight.current = false;
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
    const status = check?.status ?? 'unknown';
    const config = STATUS_CONFIG[status];

    return (
      <article
        key={sub.key}
        data-testid="status-card"
        className="flex min-w-0 flex-col justify-between rounded-2xl border border-bistro-border bg-white p-5 shadow-sm"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl bg-bistro-page text-bistro-action-secondary"
            aria-hidden="true"
          >
            {sub.icon}
          </span>
          <span
            className={
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ' +
              config.bg +
              ' ' +
              config.text
            }
          >
            <span className={'size-2 rounded-full ' + config.dot} aria-hidden="true" />
            {config.label}
          </span>
        </header>
        <div className="mt-5">
          <h3 className="font-bistro-heading text-lg font-semibold text-bistro-text-primary">
            {sub.label}
          </h3>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            {check && check.latency !== null ? (
              <>
                Latencia:{' '}
                <span className="font-semibold text-bistro-text-primary">{check.latency} ms</span>
              </>
            ) : (
              'Sin medición disponible'
            )}
          </p>
        </div>
      </article>
    );
  }

  function renderOverallBanner() {
    if (!health) return null;
    const overall = summarizeHealth(health.status, health.checks.storage);
    const isOk = overall === 'ok';
    return (
      <article
        className={
          'flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 ' +
          (isOk
            ? 'border-bistro-action-secondary/30 bg-bistro-action-secondary/10'
            : 'border-bistro-warning/30 bg-bistro-warning/10')
        }
      >
        <div className="flex items-center gap-3">
          <span
            className={
              'size-3 rounded-full ' + (isOk ? 'bg-bistro-action-secondary' : 'bg-bistro-warning')
            }
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-bistro-text-secondary">Estado global</p>
            <p className="font-bistro-heading text-lg font-semibold text-bistro-text-primary">
              {isOk
                ? 'Todo operativo'
                : overall === 'partial'
                  ? 'Estado parcial: almacenamiento sin datos'
                  : 'Degradado'}
            </p>
          </div>
        </div>
        <p className="text-xs text-bistro-text-secondary">
          v{health.version}
          {lastUpdated ? ' · Actualizado ' + lastUpdated.toLocaleTimeString() : ''}
        </p>
      </article>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <section className="space-y-5">
      <header className="rounded-[26px] bg-bistro-inverse px-6 py-7 text-white shadow-sm sm:px-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-bistro-champagne">
          <ActivityIcon size={16} /> Supervisión de servicios
        </p>
        <h2 className="mt-3 font-bistro-heading text-3xl font-semibold sm:text-4xl">
          Estado del sistema
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-bistro-cream">
          Consultá el estado real de PostgreSQL, Redis, Gemini y almacenamiento S3. Actualización
          automática cada 30 segundos.
        </p>
      </header>

      {renderOverallBanner()}

      {fetchError ? (
        <article
          role="alert"
          className="rounded-2xl border border-bistro-danger/30 bg-bistro-danger/10 p-5"
        >
          <p className="font-semibold text-bistro-danger">
            No se pudo obtener el estado del sistema
          </p>
          <p className="mt-1 break-words text-sm text-bistro-danger">{fetchError}</p>
          <button
            type="button"
            onClick={() => void fetchHealth()}
            className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-bistro-danger/30 px-4 text-sm font-semibold text-bistro-danger"
          >
            Reintentar
          </button>
        </article>
      ) : null}

      <section
        aria-labelledby="owner-dependencies"
        className="rounded-[26px] border border-bistro-border bg-bistro-page/60 p-4 sm:p-6"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="owner-dependencies" className="font-bistro-heading text-xl font-semibold">
              Servicios y dependencias
            </h3>
            <p className="mt-1 text-sm text-bistro-text-secondary">
              Cada tarjeta muestra una comprobación independiente.
            </p>
          </div>
          {loading ? (
            <span
              role="status"
              className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-bistro-text-secondary"
            >
              Verificando servicios…
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SUBSYSTEMS.map((sub) => (
              <article
                key={sub.key}
                className="flex min-h-40 flex-col justify-between rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-5"
              >
                <span
                  className="flex size-11 items-center justify-center rounded-xl bg-bistro-page text-bistro-action-secondary"
                  aria-hidden="true"
                >
                  {sub.icon}
                </span>
                <div className="mt-5">
                  <h4 className="font-bistro-heading text-base font-semibold sm:text-lg">
                    {sub.label}
                  </h4>
                  <p className="mt-1 text-xs text-bistro-text-secondary">Esperando medición…</p>
                </div>
              </article>
            ))}
          </div>
        ) : health ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SUBSYSTEMS.map(renderStatusCard)}
          </div>
        ) : (
          <p className="rounded-2xl bg-white p-5 text-sm text-bistro-text-secondary">
            Sin datos disponibles. Usá Reintentar para consultar nuevamente.
          </p>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bistro-border bg-white px-5 py-4">
        <p className="text-xs text-bistro-text-secondary">
          {health?.timestamp
            ? 'Último chequeo: ' + new Date(health.timestamp).toLocaleString()
            : 'Última comprobación: sin datos'}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchHealth();
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-bistro-border px-4 text-sm font-semibold text-bistro-text-primary hover:bg-bistro-page"
        >
          <RefreshCw size={16} aria-hidden="true" /> Refrescar ahora
        </button>
      </footer>
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
