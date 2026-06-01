import type { ProviderSettings } from './models';
import type { ClarifyRequest, ClarifyResponse } from './providers/types';

export const CLARIFY_MESSAGE_TYPE = 'sidenote:clarify';
export const CLARIFY_CANCEL_MESSAGE_TYPE = 'sidenote:clarify:cancel';
export const PROVIDER_STATUS_MESSAGE_TYPE = 'sidenote:provider:status';
export const PROVIDER_SECRET_SAVE_MESSAGE_TYPE =
  'sidenote:provider-secret:save';
export const PROVIDER_SECRET_REMOVE_MESSAGE_TYPE =
  'sidenote:provider-secret:remove';
export const PROVIDER_OPTIONS_OPEN_MESSAGE_TYPE =
  'sidenote:provider-options:open';
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export interface ClarifyRuntimeMessage {
  type: typeof CLARIFY_MESSAGE_TYPE;
  requestId: string;
  request: ClarifyRequest;
}

export interface ClarifyCancelRuntimeMessage {
  type: typeof CLARIFY_CANCEL_MESSAGE_TYPE;
  requestId: string;
}

export interface ProviderStatusRuntimeMessage {
  type: typeof PROVIDER_STATUS_MESSAGE_TYPE;
}

export interface ProviderSecretSaveRuntimeMessage {
  type: typeof PROVIDER_SECRET_SAVE_MESSAGE_TYPE;
  presetId: string;
  token: string;
}

export interface ProviderSecretRemoveRuntimeMessage {
  type: typeof PROVIDER_SECRET_REMOVE_MESSAGE_TYPE;
  presetId: string;
}

export interface ProviderOptionsOpenRuntimeMessage {
  type: typeof PROVIDER_OPTIONS_OPEN_MESSAGE_TYPE;
}

export type ClarifyRuntimeResponse =
  | {
      ok: true;
      response: ClarifyResponse;
    }
  | {
      ok: false;
      error: string;
    };

export interface ProviderStatusResult {
  ok: boolean;
  label: string;
  failures: string[];
  settings: ProviderSettings;
}

export type ProviderStatusRuntimeResponse =
  | {
      ok: true;
      status: ProviderStatusResult;
    }
  | {
      ok: false;
      error: string;
    };

export type RuntimeMessage =
  | ClarifyRuntimeMessage
  | ClarifyCancelRuntimeMessage
  | ProviderStatusRuntimeMessage
  | ProviderSecretSaveRuntimeMessage
  | ProviderSecretRemoveRuntimeMessage
  | ProviderOptionsOpenRuntimeMessage;
export type RuntimeMessageResponse =
  | ClarifyRuntimeResponse
  | ProviderStatusRuntimeResponse
  | { ok: true };

export type RuntimeMessageSender = (
  message: RuntimeMessage,
  callback: (response?: RuntimeMessageResponse) => void,
) => void;

declare const chrome: {
  runtime: {
    lastError?: {
      message?: string;
    };
    sendMessage?: RuntimeMessageSender;
  };
};

export async function requestClarification(
  request: ClarifyRequest,
  sendMessage: RuntimeMessageSender = getRuntimeSendMessage(),
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ClarifyResponse> {
  return sendClarifyMessage(sendMessage, request, options);
}

export function isClarifyRuntimeMessage(
  message: unknown,
): message is ClarifyRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Partial<ClarifyRuntimeMessage>).type === CLARIFY_MESSAGE_TYPE
  );
}

export function isClarifyCancelRuntimeMessage(
  message: unknown,
): message is ClarifyCancelRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Partial<ClarifyCancelRuntimeMessage>).type ===
      CLARIFY_CANCEL_MESSAGE_TYPE &&
    typeof (message as Partial<ClarifyCancelRuntimeMessage>).requestId ===
      'string'
  );
}

export function isProviderStatusRuntimeMessage(
  message: unknown,
): message is ProviderStatusRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Partial<ProviderStatusRuntimeMessage>).type ===
      PROVIDER_STATUS_MESSAGE_TYPE
  );
}

export function isProviderSecretSaveRuntimeMessage(
  message: unknown,
): message is ProviderSecretSaveRuntimeMessage {
  const candidate = message as Partial<ProviderSecretSaveRuntimeMessage>;

  return (
    !!message &&
    typeof message === 'object' &&
    candidate.type === PROVIDER_SECRET_SAVE_MESSAGE_TYPE &&
    typeof candidate.presetId === 'string' &&
    typeof candidate.token === 'string'
  );
}

export function isProviderSecretRemoveRuntimeMessage(
  message: unknown,
): message is ProviderSecretRemoveRuntimeMessage {
  const candidate = message as Partial<ProviderSecretRemoveRuntimeMessage>;

  return (
    !!message &&
    typeof message === 'object' &&
    candidate.type === PROVIDER_SECRET_REMOVE_MESSAGE_TYPE &&
    typeof candidate.presetId === 'string'
  );
}

export function isProviderOptionsOpenRuntimeMessage(
  message: unknown,
): message is ProviderOptionsOpenRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Partial<ProviderOptionsOpenRuntimeMessage>).type ===
      PROVIDER_OPTIONS_OPEN_MESSAGE_TYPE
  );
}

export async function requestProviderStatus(
  sendMessage: RuntimeMessageSender = getRuntimeSendMessage(),
  options: {
    timeoutMs?: number;
  } = {},
): Promise<ProviderStatusResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(() => {
        reject(new Error('Provider status check timed out.'));
      });
    }, options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    try {
      sendMessage(
        {
          type: PROVIDER_STATUS_MESSAGE_TYPE,
        },
        (response) => {
          if (settled) {
            return;
          }

          const lastError = getChromeLastError();

          if (lastError) {
            finish(() => {
              reject(new Error(lastError.message ?? 'Message failed.'));
            });
            return;
          }

          if (!response) {
            finish(() => {
              reject(new Error('No response from Sidenote background worker.'));
            });
            return;
          }

          if (!response.ok) {
            finish(() => {
              reject(new Error(response.error));
            });
            return;
          }

          if (!('status' in response)) {
            finish(() => {
              reject(new Error('Unexpected Sidenote background response.'));
            });
            return;
          }

          finish(() => {
            resolve(response.status);
          });
        },
      );
    } catch (error) {
      finish(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }
  });
}

export async function saveProviderSecret(
  presetId: string,
  token: string,
  sendMessage: RuntimeMessageSender = getRuntimeSendMessage(),
): Promise<void> {
  await sendProviderSecretMessage(
    {
      type: PROVIDER_SECRET_SAVE_MESSAGE_TYPE,
      presetId,
      token,
    },
    sendMessage,
  );
}

export async function removeProviderSecret(
  presetId: string,
  sendMessage: RuntimeMessageSender = getRuntimeSendMessage(),
): Promise<void> {
  await sendProviderSecretMessage(
    {
      type: PROVIDER_SECRET_REMOVE_MESSAGE_TYPE,
      presetId,
    },
    sendMessage,
  );
}

export async function openProviderOptions(
  sendMessage: RuntimeMessageSender = getRuntimeSendMessage(),
): Promise<void> {
  await sendProviderSecretMessage(
    {
      type: PROVIDER_OPTIONS_OPEN_MESSAGE_TYPE,
    },
    sendMessage,
  );
}

function sendClarifyMessage(
  sendMessage: RuntimeMessageSender,
  request: ClarifyRequest,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ClarifyResponse> {
  return new Promise((resolve, reject) => {
    const requestId = createRequestId();
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const signal = options.signal;
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeout !== null) {
        clearTimeout(timeout);
      }

      signal?.removeEventListener('abort', abort);
      callback();
    };
    const cancelProviderRequest = (): void => {
      sendCancelMessage(sendMessage, requestId);
    };
    const abort = (): void => {
      cancelProviderRequest();
      finish(() => {
        reject(new Error('Provider request was cancelled.'));
      });
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => {
      cancelProviderRequest();
      finish(() => {
        reject(new Error('Provider request timed out.'));
      });
    }, timeoutMs);

    try {
      sendMessage(
        {
          type: CLARIFY_MESSAGE_TYPE,
          requestId,
          request,
        },
        (response) => {
          if (settled) {
            return;
          }

          const lastError = getChromeLastError();

          if (lastError) {
            finish(() => {
              reject(new Error(lastError.message ?? 'Message failed.'));
            });
            return;
          }

          if (!response) {
            finish(() => {
              reject(new Error('No response from Sidenote background worker.'));
            });
            return;
          }

          if (!response.ok) {
            finish(() => {
              reject(new Error(response.error));
            });
            return;
          }

          if (!('response' in response)) {
            finish(() => {
              reject(new Error('Unexpected Sidenote background response.'));
            });
            return;
          }

          finish(() => {
            resolve(response.response);
          });
        },
      );
    } catch (error) {
      finish(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }
  });
}

function sendProviderSecretMessage(
  message:
    | ProviderSecretSaveRuntimeMessage
    | ProviderSecretRemoveRuntimeMessage
    | ProviderOptionsOpenRuntimeMessage,
  sendMessage: RuntimeMessageSender,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      sendMessage(message, (response) => {
        const lastError = getChromeLastError();

        if (lastError) {
          reject(new Error(lastError.message ?? 'Message failed.'));
          return;
        }

        if (!response) {
          reject(new Error('No response from Sidenote background worker.'));
          return;
        }

        if (!response.ok) {
          reject(new Error(response.error));
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function sendCancelMessage(
  sendMessage: RuntimeMessageSender,
  requestId: string,
): void {
  try {
    sendMessage(
      {
        type: CLARIFY_CANCEL_MESSAGE_TYPE,
        requestId,
      },
      () => undefined,
    );
  } catch {
    return;
  }
}

function getRuntimeSendMessage(): RuntimeMessageSender {
  if (!chrome.runtime.sendMessage) {
    throw new Error('Sidenote background worker messaging is unavailable.');
  }

  return chrome.runtime.sendMessage.bind(chrome.runtime);
}

function createRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `clarify-${Date.now().toString(36)}`;
}

function getChromeLastError(): { message?: string } | null {
  try {
    return chrome.runtime.lastError ?? null;
  } catch {
    return null;
  }
}
