export type BreakageKind = 'site-adapter' | 'highlight-repaint';
export type ProviderFailureKind = 'health-check' | 'clarify-request';

export interface HealthTelemetrySnapshot {
  breakages: Record<string, number>;
  providerFailures: Record<string, number>;
}

const counters: HealthTelemetrySnapshot = {
  breakages: {},
  providerFailures: {},
};

export function reportBreakage(kind: BreakageKind, detail: string): void {
  increment(counters.breakages, kind);
  safeWarn(`[Sidenote] ${kind}: ${detail}`);
}

export function reportProviderFailure(
  kind: ProviderFailureKind,
  detail: string,
): void {
  increment(counters.providerFailures, kind);
  safeWarn(`[Sidenote] ${kind}: ${detail}`);
}

export function getHealthTelemetrySnapshot(): HealthTelemetrySnapshot {
  return {
    breakages: { ...counters.breakages },
    providerFailures: { ...counters.providerFailures },
  };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function safeWarn(message: string): void {
  try {
    console.warn(message);
  } catch {
    return;
  }
}
