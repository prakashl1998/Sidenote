import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  type ClarifyRuntimeResponse,
  type ProviderStatusRuntimeResponse,
  isClarifyCancelRuntimeMessage,
  isClarifyRuntimeMessage,
  isProviderOptionsOpenRuntimeMessage,
  isProviderSecretRemoveRuntimeMessage,
  isProviderSecretSaveRuntimeMessage,
  isProviderStatusRuntimeMessage,
} from '../shared/messaging';
import { getActiveClarificationProvider } from '../shared/providers/registry';
import type { ClarificationProvider } from '../shared/providers/types';
import {
  getProviderSettings,
  removeProviderSecret,
  setProviderSecret,
  type ChromeStorageAreaLike,
} from '../shared/storage';
import { reportProviderFailure } from '../shared/health';

const activeClarifyControllers = new Map<string, AbortController>();

declare const chrome: {
  runtime?: {
    openOptionsPage?: (callback?: () => void) => void;
    lastError?: {
      message?: string;
    };
  };
};

export async function handleRuntimeMessage(
  message: unknown,
  provider?: ClarificationProvider,
  controllers: Map<string, AbortController> = activeClarifyControllers,
  storageArea?: ChromeStorageAreaLike,
): Promise<ClarifyRuntimeResponse | { ok: true } | null> {
  if (isClarifyCancelRuntimeMessage(message)) {
    controllers.get(message.requestId)?.abort();
    controllers.delete(message.requestId);
    return { ok: true };
  }

  if (!isClarifyRuntimeMessage(message)) {
    return null;
  }

  const controller = new AbortController();
  const timeoutState = { timedOut: false };
  const timeout = setTimeout(() => {
    timeoutState.timedOut = true;
    controller.abort();
  }, DEFAULT_PROVIDER_TIMEOUT_MS);

  controllers.set(message.requestId, controller);

  try {
    const activeProvider =
      provider ?? (await getActiveClarificationProvider(storageArea));
    const response = await activeProvider.explain(
      message.request,
      controller.signal,
    );

    return { ok: true, response };
  } catch (error) {
    reportProviderFailure(
      'clarify-request',
      timeoutState.timedOut
        ? 'Provider request timed out.'
        : error instanceof Error
          ? error.message
          : 'Provider request failed.',
    );
    return {
      ok: false,
      error: timeoutState.timedOut
        ? 'Provider request timed out.'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
    controllers.delete(message.requestId);
  }
}

export async function handleProviderSettingsRuntimeMessage(
  message: unknown,
  storageArea?: ChromeStorageAreaLike,
): Promise<ProviderStatusRuntimeResponse | { ok: true } | null> {
  if (isProviderStatusRuntimeMessage(message)) {
    return getProviderStatus(storageArea);
  }

  if (isProviderSecretSaveRuntimeMessage(message)) {
    await setProviderSecret(message.presetId, message.token, storageArea);
    return { ok: true };
  }

  if (isProviderSecretRemoveRuntimeMessage(message)) {
    await removeProviderSecret(message.presetId, storageArea);
    return { ok: true };
  }

  if (isProviderOptionsOpenRuntimeMessage(message)) {
    await openExtensionOptionsPage();
    return { ok: true };
  }

  return null;
}

function openExtensionOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const openOptionsPage = chrome.runtime?.openOptionsPage;

      if (!openOptionsPage) {
        resolve();
        return;
      }

      openOptionsPage.call(chrome.runtime, () => {
        const error = chrome.runtime?.lastError;

        if (error) {
          reject(new Error(error.message ?? 'Could not open options page.'));
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function getProviderStatus(
  storageArea?: ChromeStorageAreaLike,
): Promise<ProviderStatusRuntimeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_PROVIDER_TIMEOUT_MS);

  try {
    const settings = await getProviderSettings(storageArea);
    const provider = await getActiveClarificationProvider(storageArea);
    const health = await withHealthTimeout(
      provider.healthCheck(controller.signal),
      controller.signal,
    );

    return {
      ok: true,
      status: {
        ok: health.ok,
        label: health.ok
          ? 'Ready'
          : (health.failures[0] ?? 'Provider unavailable.'),
        failures: health.failures,
        settings,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Provider status failed.';
    reportProviderFailure('health-check', errorMessage);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function withHealthTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(new Error('Provider health check timed out.'));
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', abort);
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
