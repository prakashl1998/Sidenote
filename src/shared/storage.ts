import type {
  ConversationRecord,
  PinnedResponse,
  ProviderPreset,
  ProviderSettings,
  StoredAnnotation,
} from './models';
import {
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_EXPLAIN_QUESTION,
  DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
  DEFAULT_HUGGING_FACE_PRESET_ID,
  DEFAULT_SIDENOTE_API_BASE_URL,
  normalizeHuggingFaceRouterBaseUrl,
} from './providers/constants';

const CONVERSATION_KEY_PREFIX = 'conv:';
export const PROVIDER_SETTINGS_KEY = 'settings:providers';
export const PROVIDER_SECRET_KEY_PREFIX = 'secret:provider:';
const WRITE_DEBOUNCE_MS = 0;
const DEFAULT_NOTES_PANEL_SIDE: ProviderSettings['notesPanelSide'] = 'right';

type StorageValues = Record<string, unknown>;

export interface ChromeStorageAreaLike {
  get(
    keys: string | string[] | StorageValues | null,
    callback: (items: StorageValues) => void,
  ): void;
  set(items: StorageValues, callback?: () => void): void;
  remove(keys: string | string[], callback?: () => void): void;
}

declare const chrome: {
  runtime: {
    lastError?: {
      message?: string;
    };
  };
  storage: {
    local: ChromeStorageAreaLike;
  };
};

interface PendingWrite {
  record: ConversationRecord;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingWrites = new Map<string, PendingWrite>();
const mutationQueues = new Map<string, Promise<void>>();

export async function getConversation(
  conversationId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ConversationRecord | null> {
  try {
    const key = getConversationKey(conversationId);
    const pending = pendingWrites.get(key);

    if (pending) {
      return pending.record;
    }

    const values = await storageGet(storageArea, key);
    const record = values[key];

    return isConversationRecord(record) ? record : null;
  } catch {
    return null;
  }
}

export async function upsertAnnotation(
  annotation: StoredAnnotation,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ConversationRecord> {
  return withConversationMutation(annotation.conversationId, async () => {
    const record = await getOrCreateConversation(
      annotation.conversationId,
      storageArea,
    );
    const existingIndex = record.annotations.findIndex(
      (candidate) => candidate.id === annotation.id,
    );
    const nextAnnotations = [...record.annotations];

    if (existingIndex >= 0) {
      nextAnnotations[existingIndex] = annotation;
    } else {
      nextAnnotations.push(annotation);
    }

    const nextRecord = {
      ...record,
      annotations: nextAnnotations,
      updatedAt: annotation.updatedAt,
    };

    await writeConversation(nextRecord, storageArea);
    return nextRecord;
  });
}

export async function removeAnnotation(
  conversationId: string,
  annotationId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ConversationRecord | null> {
  return withConversationMutation(conversationId, async () => {
    const record = await getConversation(conversationId, storageArea);

    if (!record) {
      return null;
    }

    const nextRecord = {
      ...record,
      annotations: record.annotations.filter(
        (annotation) => annotation.id !== annotationId,
      ),
      updatedAt: Date.now(),
    };

    await writeConversation(nextRecord, storageArea);
    return nextRecord;
  });
}

export async function upsertPin(
  pin: PinnedResponse,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ConversationRecord> {
  return withConversationMutation(pin.conversationId, async () => {
    const record = await getOrCreateConversation(
      pin.conversationId,
      storageArea,
    );
    const existingIndex = record.pins.findIndex(
      (candidate) => candidate.id === pin.id,
    );
    const nextPins = [...record.pins];

    if (existingIndex >= 0) {
      nextPins[existingIndex] = pin;
    } else {
      nextPins.push(pin);
    }

    const nextRecord = {
      ...record,
      pins: nextPins,
      updatedAt: pin.createdAt,
    };

    await writeConversation(nextRecord, storageArea);
    return nextRecord;
  });
}

export async function removePin(
  conversationId: string,
  pinId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ConversationRecord | null> {
  return withConversationMutation(conversationId, async () => {
    const record = await getConversation(conversationId, storageArea);

    if (!record) {
      return null;
    }

    const nextRecord = {
      ...record,
      pins: record.pins.filter((pin) => pin.id !== pinId),
      updatedAt: Date.now(),
    };

    await writeConversation(nextRecord, storageArea);
    return nextRecord;
  });
}

export async function clearConversation(
  conversationId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<void> {
  try {
    await storageRemove(storageArea, getConversationKey(conversationId));
  } catch {
    return;
  }
}

export async function clearConversationRecords(
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<void> {
  try {
    const values = await storageGet(storageArea, null);
    const keys = Object.keys(values).filter((key) =>
      key.startsWith(CONVERSATION_KEY_PREFIX),
    );

    for (const [key, pending] of pendingWrites) {
      if (key.startsWith(CONVERSATION_KEY_PREFIX)) {
        clearTimeout(pending.timer);
        pendingWrites.delete(key);
        pending.resolve();
        keys.push(key);
      }
    }

    if (keys.length > 0) {
      await storageRemove(storageArea, Array.from(new Set(keys)));
    }
  } catch {
    return;
  }
}

export async function getProviderSettings(
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ProviderSettings> {
  try {
    const values = await storageGet(storageArea, PROVIDER_SETTINGS_KEY);
    const settings = values[PROVIDER_SETTINGS_KEY];

    return normalizeProviderSettings(settings);
  } catch {
    return getDefaultProviderSettings();
  }
}

export async function updateProviderSettings(
  settings: ProviderSettings,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ProviderSettings> {
  const normalized = normalizeProviderSettings(settings);

  try {
    await storageSet(storageArea, { [PROVIDER_SETTINGS_KEY]: normalized });
  } catch {
    return normalized;
  }

  return normalized;
}

export async function resetProviderSettings(
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<ProviderSettings> {
  try {
    const values = await storageGet(storageArea, null);
    const keys = Object.keys(values).filter(
      (key) =>
        key === PROVIDER_SETTINGS_KEY ||
        key.startsWith(PROVIDER_SECRET_KEY_PREFIX),
    );

    if (keys.length > 0) {
      await storageRemove(storageArea, keys);
    }
  } catch {
    return getDefaultProviderSettings();
  }

  return getDefaultProviderSettings();
}

export async function getProviderSecret(
  presetId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<string | null> {
  try {
    const key = getProviderSecretKey(presetId);
    const values = await storageGet(storageArea, key);
    const secret = values[key];

    return typeof secret === 'string' && secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

export async function setProviderSecret(
  presetId: string,
  secret: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<void> {
  const trimmed = secret.trim();

  if (trimmed.length === 0) {
    await removeProviderSecret(presetId, storageArea);
    return;
  }

  try {
    await storageSet(storageArea, {
      [getProviderSecretKey(presetId)]: trimmed,
    });
  } catch {
    return;
  }
}

export async function removeProviderSecret(
  presetId: string,
  storageArea: ChromeStorageAreaLike = getStorageArea(),
): Promise<void> {
  try {
    await storageRemove(storageArea, getProviderSecretKey(presetId));
  } catch {
    return;
  }
}

export function getConversationKey(conversationId: string): string {
  return `${CONVERSATION_KEY_PREFIX}${conversationId}`;
}

export function getProviderSecretKey(presetId: string): string {
  return `${PROVIDER_SECRET_KEY_PREFIX}${presetId}`;
}

async function getOrCreateConversation(
  conversationId: string,
  storageArea: ChromeStorageAreaLike,
): Promise<ConversationRecord> {
  return (
    (await getConversation(conversationId, storageArea)) ?? {
      conversationId,
      annotations: [],
      pins: [],
      updatedAt: Date.now(),
    }
  );
}

function writeConversation(
  record: ConversationRecord,
  storageArea: ChromeStorageAreaLike,
): Promise<void> {
  const key = getConversationKey(record.conversationId);
  const pending = pendingWrites.get(key);

  if (pending) {
    pending.record = record;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      flushConversationWrite(key, storageArea).catch(pending.reject);
    }, WRITE_DEBOUNCE_MS);

    return pending.promise;
  }

  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const nextPending: PendingWrite = {
    record,
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    timer: setTimeout(() => {
      flushConversationWrite(key, storageArea).catch(rejectPromise);
    }, WRITE_DEBOUNCE_MS),
  };

  pendingWrites.set(key, nextPending);
  return promise;
}

async function withConversationMutation<T>(
  conversationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = getConversationKey(conversationId);
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);

  mutationQueues.set(key, queued);

  try {
    await previous.catch(() => undefined);
    return await operation();
  } finally {
    releaseQueue();

    if (mutationQueues.get(key) === queued) {
      mutationQueues.delete(key);
    }
  }
}

async function flushConversationWrite(
  key: string,
  storageArea: ChromeStorageAreaLike,
): Promise<void> {
  const pending = pendingWrites.get(key);

  if (!pending) {
    return;
  }

  pendingWrites.delete(key);

  try {
    await storageSet(storageArea, { [key]: pending.record });
    pending.resolve();
  } catch (error) {
    pending.reject(toError(error));
  }
}

function storageGet(
  storageArea: ChromeStorageAreaLike,
  key: string | null,
): Promise<StorageValues> {
  return new Promise((resolve, reject) => {
    try {
      storageArea.get(key, (items) => {
        const error = getChromeLastError();

        if (error) {
          if (isExtensionContextInvalidated(error)) {
            resolve({});
            return;
          }

          reject(new Error(error.message));
          return;
        }

        resolve(items);
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        resolve({});
        return;
      }

      reject(toError(error));
    }
  });
}

function storageSet(
  storageArea: ChromeStorageAreaLike,
  items: StorageValues,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      storageArea.set(items, () => {
        const error = getChromeLastError();

        if (error) {
          if (isExtensionContextInvalidated(error)) {
            resolve();
            return;
          }

          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        resolve();
        return;
      }

      reject(toError(error));
    }
  });
}

function storageRemove(
  storageArea: ChromeStorageAreaLike,
  key: string | string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      storageArea.remove(key, () => {
        const error = getChromeLastError();

        if (error) {
          if (isExtensionContextInvalidated(error)) {
            resolve();
            return;
          }

          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        resolve();
        return;
      }

      reject(toError(error));
    }
  });
}

function getStorageArea(): ChromeStorageAreaLike {
  try {
    return chrome.storage.local;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      return createNoopStorageArea();
    }

    throw error;
  }
}

function getChromeLastError(): { message?: string } | null {
  try {
    return chrome.runtime.lastError ?? null;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      return { message: toError(error).message };
    }

    throw error;
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  return toError(error).message.includes('Extension context invalidated');
}

function createNoopStorageArea(): ChromeStorageAreaLike {
  return {
    get(_keys, callback) {
      callback({});
    },
    set(_items, callback) {
      callback?.();
    },
    remove(_keys, callback) {
      callback?.();
    },
  };
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ConversationRecord>;
  return (
    typeof candidate.conversationId === 'string' &&
    Array.isArray(candidate.annotations) &&
    Array.isArray(candidate.pins) &&
    typeof candidate.updatedAt === 'number'
  );
}

function normalizeProviderSettings(value: unknown): ProviderSettings {
  const defaults = getDefaultProviderSettings();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  const activeProviderId =
    candidate.activeProviderId === 'huggingface' ||
    candidate.activeProviderId === 'openai-compatible' ||
    candidate.activeProviderId === 'sidenote-api'
      ? candidate.activeProviderId
      : defaults.activeProviderId;
  const byokPresets: ProviderPreset[] = Array.isArray(candidate.byokPresets)
    ? candidate.byokPresets.filter((preset): preset is ProviderPreset => {
        const candidatePreset = preset as Record<string, unknown>;

        return (
          !!preset &&
          typeof preset === 'object' &&
          typeof candidatePreset.id === 'string' &&
          (candidatePreset.providerId === 'huggingface' ||
            candidatePreset.providerId === 'openai-compatible') &&
          typeof candidatePreset.label === 'string' &&
          typeof candidatePreset.baseUrl === 'string' &&
          typeof candidatePreset.model === 'string' &&
          typeof candidatePreset.apiKeyStorageKey === 'string' &&
          typeof candidatePreset.createdAt === 'number' &&
          typeof candidatePreset.updatedAt === 'number'
        );
      })
    : defaults.byokPresets;

  return {
    activeProviderId,
    sidenoteApiBaseUrl:
      typeof candidate.sidenoteApiBaseUrl === 'string' &&
      candidate.sidenoteApiBaseUrl.length > 0
        ? candidate.sidenoteApiBaseUrl
        : defaults.sidenoteApiBaseUrl,
    huggingFaceRouterBaseUrl: normalizeHuggingFaceRouterBaseUrl(
      candidate.huggingFaceRouterBaseUrl,
    ),
    huggingFacePresetId:
      typeof candidate.huggingFacePresetId === 'string' &&
      candidate.huggingFacePresetId.length > 0
        ? candidate.huggingFacePresetId
        : defaults.huggingFacePresetId,
    defaultModel:
      typeof candidate.defaultModel === 'string' &&
      candidate.defaultModel.length > 0
        ? candidate.defaultModel
        : defaults.defaultModel,
    defaultExplainQuestion:
      typeof candidate.defaultExplainQuestion === 'string' &&
      candidate.defaultExplainQuestion.trim().length > 0
        ? candidate.defaultExplainQuestion.trim()
        : defaults.defaultExplainQuestion,
    notesPanelSide:
      candidate.notesPanelSide === 'left' ||
      candidate.notesPanelSide === 'right'
        ? candidate.notesPanelSide
        : defaults.notesPanelSide,
    byokPresets,
    privacyDisclosureAcceptedAt:
      typeof candidate.privacyDisclosureAcceptedAt === 'number'
        ? candidate.privacyDisclosureAcceptedAt
        : undefined,
  };
}

function getDefaultProviderSettings(): ProviderSettings {
  const now = 0;

  return {
    activeProviderId: 'huggingface',
    sidenoteApiBaseUrl: DEFAULT_SIDENOTE_API_BASE_URL,
    huggingFaceRouterBaseUrl: DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
    huggingFacePresetId: DEFAULT_HUGGING_FACE_PRESET_ID,
    defaultModel: DEFAULT_CLARIFY_MODEL,
    defaultExplainQuestion: DEFAULT_EXPLAIN_QUESTION,
    notesPanelSide: DEFAULT_NOTES_PANEL_SIDE,
    byokPresets: [
      {
        id: DEFAULT_HUGGING_FACE_PRESET_ID,
        providerId: 'huggingface',
        label: 'Hugging Face',
        baseUrl: DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
        model: DEFAULT_CLARIFY_MODEL,
        apiKeyStorageKey: getProviderSecretKey(DEFAULT_HUGGING_FACE_PRESET_ID),
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
