import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatGptAdapter } from '../../src/content/adapters/chatgpt-adapter';
import { HighlightRenderer } from '../../src/content/highlight-renderer';
import { bootstrapContentScript } from '../../src/content';
import type { StoredAnnotation } from '../../src/shared/models';
import {
  getConversation,
  type ChromeStorageAreaLike,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-2',
} as Location;

describe('Phase 2 Save action and highlight renderer', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000002',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('saves a selected assistant passage, stores it, and paints a highlight', async () => {
    const assistantText = renderFixture('The saved phrase belongs here.');

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    selectText(assistantText, 'saved phrase', rect(120, 160, 120, 24));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickSaveButton();
    await settle();

    const record = await getConversation('phase-2', storageArea);
    const highlight = document.querySelector<HTMLElement>(
      '[data-sidenote-highlight-id]',
    );

    expect(record?.annotations).toHaveLength(1);
    expect(record?.annotations[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'save',
      messageKey: 'assistant-1',
    });
    expect(record?.annotations[0]?.quote.exact).toBe('saved phrase');
    expect(highlight?.textContent).toBe('saved phrase');
  });

  it('repaints persisted highlights after a page reload', async () => {
    const annotation = makeAnnotation('saved phrase');
    seedAnnotation(storageArea, annotation);

    renderFixture('The saved phrase belongs here.');
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    await settle();

    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]')
        ?.textContent,
    ).toBe('saved phrase');
  });

  it('re-anchors and repaints when the assistant DOM node is replaced', async () => {
    const assistantText = renderFixture('The durable phrase belongs here.');

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    selectText(assistantText, 'durable phrase', rect(120, 160, 120, 24));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickSaveButton();
    await settle();

    replaceAssistantMessage('The durable phrase belongs here.');
    await settle(90);

    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]')
        ?.textContent,
    ).toBe('durable phrase');
  });

  it('re-anchors after a wrapper re-render when ChatGPT puts message id on a nested node', () => {
    const annotation = {
      ...makeAnnotation('durable phrase'),
      messageKey: 'nested-assistant-1',
    };
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const renderer = new HighlightRenderer(adapter);

    renderNestedMessageIdFixture('The durable phrase belongs here.');

    expect(renderer.paint([annotation])[0]).toMatchObject({
      orphaned: false,
    });
    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]')
        ?.textContent,
    ).toBe('durable phrase');

    renderNestedMessageIdFixture('The durable phrase belongs here.');

    expect(renderer.paint([annotation])[0]).toMatchObject({
      orphaned: false,
    });
    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]')
        ?.textContent,
    ).toBe('durable phrase');
  });

  it('reports orphaned highlights when the saved text is gone', () => {
    const annotation = makeAnnotation('missing phrase');
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const renderer = new HighlightRenderer(adapter);

    renderFixture('The replacement text belongs here.');

    const [result] = renderer.paint([annotation]);

    expect(result).toMatchObject({ orphaned: true });
    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]'),
    ).toBeNull();
  });

  it('paints multi-node highlights without moving list structure into a mark', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant" data-message-id="assistant-1"><ul><li>First reason</li><li>Second reason</li></ul></article>
      </main>
    `;
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const renderer = new HighlightRenderer(adapter);

    const [result] = renderer.paint([
      {
        ...makeAnnotation('reasonSecond'),
        position: { start: 6, end: 18 },
        quote: {
          exact: 'reasonSecond',
          prefix: 'First ',
          suffix: ' reason',
        },
      },
    ]);

    expect(result.orphaned).toBe(false);
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelector('mark li')).toBeNull();
    expect(
      Array.from(document.querySelectorAll('li')).map(
        (item) => item.textContent,
      ),
    ).toEqual(['First reason', 'Second reason']);
    expect(
      document.querySelectorAll('[data-sidenote-highlight-id]'),
    ).toHaveLength(2);
  });

  it('surfaces orphaned saved highlights from the content script', async () => {
    seedAnnotation(storageArea, makeAnnotation('missing phrase'));

    renderFixture('The replacement text belongs here.');
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    await settle();

    const status = document
      .getElementById('sidenote-overlay-root')
      ?.shadowRoot?.querySelector<HTMLDivElement>('#sidenote-orphan-status');

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("1 highlight couldn't be re-located.");
  });
});

function renderFixture(assistantMessage: string): Text {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="user" data-message-id="user-1">
        <p>User message.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>${assistantMessage}</p>
      </article>
    </main>
  `;

  const textNode = document.querySelector(
    '[data-message-id="assistant-1"] p',
  )?.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Expected assistant text node.');
  }

  return textNode;
}

function replaceAssistantMessage(assistantMessage: string): void {
  const current = document.querySelector<HTMLElement>(
    '[data-message-id="assistant-1"]',
  );
  const replacement = document.createElement('article');
  replacement.dataset.messageAuthorRole = 'assistant';
  replacement.dataset.messageId = 'assistant-1';
  replacement.innerHTML = `<p>${assistantMessage}</p>`;

  current?.replaceWith(replacement);
}

function renderNestedMessageIdFixture(assistantMessage: string): void {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="user" data-message-id="user-1">
        <p>User message.</p>
      </article>
      <article data-message-author-role="assistant">
        <div data-message-id="nested-assistant-1">
          <p>${assistantMessage}</p>
        </div>
      </article>
    </main>
  `;
}

function selectText(
  textNode: Text,
  selectedText: string,
  bounds: DOMRect,
): void {
  const start = textNode.data.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + selectedText.length);
  mockRangeRect(range, bounds);

  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function mockRangeRect(range: Range, bounds: DOMRect): void {
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => bounds,
  });
  Object.defineProperty(range, 'getClientRects', {
    configurable: true,
    value: () => [bounds],
  });
}

function clickSaveButton(): void {
  const saveButton = document
    .getElementById('sidenote-overlay-root')
    ?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Save"]');

  if (!saveButton) {
    throw new Error('Save button was not rendered.');
  }

  saveButton.click();
}

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(left, top, width, height);
}

function seedAnnotation(
  storageArea: ChromeStorageAreaLike,
  annotation: StoredAnnotation,
): void {
  storageAreaSet(storageArea, {
    'conv:phase-2': {
      conversationId: 'phase-2',
      annotations: [annotation],
      pins: [],
      updatedAt: annotation.updatedAt,
    },
  });
}

function makeAnnotation(exact: string): StoredAnnotation {
  return {
    id: 'saved-1',
    conversationId: 'phase-2',
    messageKey: 'assistant-1',
    kind: 'save',
    quote: {
      exact,
      prefix: 'The ',
      suffix: ' belongs here.',
    },
    position: {
      start: 4,
      end: 4 + exact.length,
    },
    color: '#fff2a8',
    collapsed: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMemoryStorage(): ChromeStorageAreaLike {
  const values = new Map<string, unknown>();
  const setValues = (items: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(items)) {
      values.set(key, value);
    }
  };

  return {
    get(keys, callback) {
      if (typeof keys === 'string') {
        callback({ [keys]: values.get(keys) });
        return;
      }

      callback({});
    },
    set(items, callback) {
      setValues(items);
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

function storageAreaSet(
  storage: ChromeStorageAreaLike,
  items: Record<string, unknown>,
): void {
  storage.set(items);
}

function settle(delay = 20): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}
