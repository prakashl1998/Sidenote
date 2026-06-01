import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTextAnchor,
  resolveTextAnchor,
} from '../../src/content/anchoring';
import type { StoredAnnotation } from '../../src/shared/models';
import {
  clearConversation,
  getConversation,
  type ChromeStorageAreaLike,
  removeAnnotation,
  removePin,
  upsertAnnotation,
  upsertPin,
} from '../../src/shared/storage';

describe('Phase 2 anchoring', () => {
  it('creates a text quote anchor and resolves it back to the same text', () => {
    const root = renderMessage(
      'Alpha context before the anchored phrase and suffix.',
    );
    const range = selectSubstring(root, 'anchored phrase');
    const anchor = createTextAnchor(root, range);
    const resolved = resolveTextAnchor(root, anchor.quote, anchor.position);

    expect(anchor.quote).toEqual({
      exact: 'anchored phrase',
      prefix: 'Alpha context before the ',
      suffix: ' and suffix.',
    });
    expect(resolved?.range.toString()).toBe('anchored phrase');
  });

  it('re-resolves after surrounding text shifts by using prefix and suffix context', () => {
    const root = renderMessage('First version keeps the durable term nearby.');
    const range = selectSubstring(root, 'durable term');
    const anchor = createTextAnchor(root, range);

    root.textContent =
      'A new lead-in appears. First version keeps the durable term nearby.';

    const resolved = resolveTextAnchor(root, anchor.quote, anchor.position);

    expect(resolved?.range.toString()).toBe('durable term');
    expect(resolved?.position.start).toBeGreaterThan(anchor.position.start);
  });

  it('returns null when the exact anchored text is gone', () => {
    const root = renderMessage('The removable phrase starts here.');
    const range = selectSubstring(root, 'removable phrase');
    const anchor = createTextAnchor(root, range);

    root.textContent = 'The replacement text starts here.';

    expect(resolveTextAnchor(root, anchor.quote, anchor.position)).toBeNull();
  });
});

describe('Phase 2 storage wrapper', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
  });

  it('returns null for a missing conversation and round-trips saved annotations', async () => {
    expect(await getConversation('phase-2', storageArea)).toBeNull();

    const annotation = makeAnnotation({ id: 'saved-1', quote: 'round trip' });
    const record = await upsertAnnotation(annotation, storageArea);

    expect(record.annotations).toHaveLength(1);
    expect(await getConversation('phase-2', storageArea)).toMatchObject({
      conversationId: 'phase-2',
      annotations: [expect.objectContaining({ id: 'saved-1' })],
      pins: [],
    });
  });

  it('coalesces pending writes so the last annotation update wins', async () => {
    const first = makeAnnotation({
      id: 'saved-1',
      quote: 'first',
      updatedAt: 10,
    });
    const second = makeAnnotation({
      id: 'saved-1',
      quote: 'second',
      updatedAt: 20,
    });

    await Promise.all([
      upsertAnnotation(first, storageArea),
      upsertAnnotation(second, storageArea),
    ]);

    const record = await getConversation('phase-2', storageArea);

    expect(record?.annotations).toHaveLength(1);
    expect(record?.annotations[0]?.quote.exact).toBe('second');
    expect(record?.updatedAt).toBe(20);
  });

  it('merges rapid saves for different annotations before the debounced write flushes', async () => {
    const first = makeAnnotation({
      id: 'saved-1',
      quote: 'first',
      updatedAt: 10,
    });
    const second = makeAnnotation({
      id: 'saved-2',
      quote: 'second',
      updatedAt: 20,
    });

    await Promise.all([
      upsertAnnotation(first, storageArea),
      upsertAnnotation(second, storageArea),
    ]);

    const record = await getConversation('phase-2', storageArea);

    expect(record?.annotations.map((annotation) => annotation.id)).toEqual([
      'saved-1',
      'saved-2',
    ]);
  });

  it('removes annotations and clears the conversation key', async () => {
    const annotation = makeAnnotation({ id: 'saved-1', quote: 'saved text' });

    await upsertAnnotation(annotation, storageArea);
    await removeAnnotation('phase-2', 'saved-1', storageArea);

    expect(await getConversation('phase-2', storageArea)).toMatchObject({
      annotations: [],
    });

    await clearConversation('phase-2', storageArea);
    expect(await getConversation('phase-2', storageArea)).toBeNull();
  });

  it('round-trips and removes pinned responses', async () => {
    await upsertPin(
      {
        id: 'pin-1',
        conversationId: 'phase-2',
        messageKey: 'assistant-1',
        excerptMarkdown: 'Pinned assistant answer.',
        label: 'Pinned answer',
        createdAt: 12,
      },
      storageArea,
    );

    expect(await getConversation('phase-2', storageArea)).toMatchObject({
      pins: [
        {
          id: 'pin-1',
          excerptMarkdown: 'Pinned assistant answer.',
        },
      ],
    });

    await removePin('phase-2', 'pin-1', storageArea);

    expect(await getConversation('phase-2', storageArea)).toMatchObject({
      pins: [],
    });
  });

  it('quietly no-ops stale Chrome storage calls after extension context invalidation', async () => {
    const invalidatedStorage = createInvalidatedStorage();
    const annotation = makeAnnotation({
      id: 'stale-context',
      quote: 'stale context',
    });

    await expect(
      upsertAnnotation(annotation, invalidatedStorage),
    ).resolves.toMatchObject({
      annotations: [expect.objectContaining({ id: 'stale-context' })],
    });
    await expect(
      removeAnnotation('phase-2', 'stale-context', invalidatedStorage),
    ).resolves.toBeNull();
    await expect(
      getConversation('phase-2', invalidatedStorage),
    ).resolves.toBeNull();
  });
});

function renderMessage(text: string): HTMLElement {
  document.body.innerHTML = `<article>${text}</article>`;
  const element = document.querySelector<HTMLElement>('article');

  if (!element) {
    throw new Error('Fixture did not render.');
  }

  return element;
}

function selectSubstring(root: HTMLElement, substring: string): Range {
  const textNode = root.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Fixture did not render a text node.');
  }

  const start = textNode.data.indexOf(substring);

  if (start < 0) {
    throw new Error(`Could not find substring "${substring}".`);
  }

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + substring.length);

  return range;
}

function makeAnnotation(overrides: {
  id: string;
  quote: string;
  updatedAt?: number;
}): StoredAnnotation {
  const updatedAt = overrides.updatedAt ?? 1;

  return {
    id: overrides.id,
    conversationId: 'phase-2',
    messageKey: 'assistant-1',
    kind: 'save',
    quote: {
      exact: overrides.quote,
      prefix: '',
      suffix: '',
    },
    position: {
      start: 0,
      end: overrides.quote.length,
    },
    color: '#fff2a8',
    collapsed: true,
    createdAt: 1,
    updatedAt,
  };
}

function createMemoryStorage(): ChromeStorageAreaLike {
  const values = new Map<string, unknown>();

  return {
    get(keys, callback) {
      if (typeof keys === 'string') {
        callback({ [keys]: values.get(keys) });
        return;
      }

      callback({});
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, value);
      }

      callback?.();
    },
    remove(keys, callback) {
      const keysToRemove = Array.isArray(keys) ? keys : [keys];

      for (const key of keysToRemove) {
        values.delete(key);
      }

      callback?.();
    },
  };
}

function createInvalidatedStorage(): ChromeStorageAreaLike {
  const throwInvalidated = (): never => {
    throw new Error('Extension context invalidated.');
  };

  return {
    get: throwInvalidated,
    set: throwInvalidated,
    remove: throwInvalidated,
  };
}
