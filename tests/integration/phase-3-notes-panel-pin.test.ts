import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapContentScript } from '../../src/content';
import {
  getConversation,
  type ChromeStorageAreaLike,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-3',
} as Location;

describe('Phase 3 Notes panel and Pin flow', () => {
  let storageArea: ChromeStorageAreaLike;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    scrollIntoView = vi.fn();
    vi.stubGlobal('chrome', { runtime: {} });
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('lists saved annotations and pins, navigates to their sources, deletes them, and persists state', async () => {
    const { savedText } = renderFixture();

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(savedText, 'saved phrase', rect(120, 160, 120, 24));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Save');
    await settle();

    setMessageRect('assistant-2', new DOMRect(200, 100, 300, 80));
    showPinButton('assistant-2');

    const pinButton = getPinButton();

    expect(pinButton.style.top).toBe('108px');
    expect(pinButton.style.left).toBe('448px');

    setMessageRect('assistant-2', new DOMRect(120, 40, 240, 80));
    window.dispatchEvent(new Event('scroll'));

    expect(pinButton.style.top).toBe('48px');
    expect(pinButton.style.left).toBe('308px');

    pinButton.click();
    await settle();
    openNotesPanel();

    expect(getNotesPanelText()).toContain('Saved');
    expect(getNotesPanelText()).toContain('saved phrase');
    expect(getNotesPanelText()).toContain('Pinned');
    expect(getNotesPanelText()).toContain('Pin this complete answer');

    clickNotesRow('annotation', '00000000-0000-4000-8000-000000000003');
    clickNotesRow('pin', '00000000-0000-4000-8000-000000000004');

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector<HTMLElement>('[data-sidenote-highlight-id]')?.style
        .outline,
    ).toBe('2px solid #2563eb');

    resetDomForReload();
    renderFixture();
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      storageArea,
      windowRef: window,
    });
    await settle();
    openNotesPanel();

    expect(getNotesPanelText()).toContain('saved phrase');
    expect(getNotesPanelText()).toContain('Pin this complete answer');
    expect(
      document.querySelector('[data-sidenote-highlight-id]')?.textContent,
    ).toBe('saved phrase');

    clickDeleteButton('annotation', '00000000-0000-4000-8000-000000000003');
    await settle();
    clickDeleteButton('pin', '00000000-0000-4000-8000-000000000004');
    await settle();

    const record = await getConversation('phase-3', storageArea);

    expect(record?.annotations).toEqual([]);
    expect(record?.pins).toEqual([]);
    expect(getNotesPanelText()).not.toContain('saved phrase');
    expect(getNotesPanelText()).not.toContain('Pin this complete answer');
    expect(document.querySelector('[data-sidenote-highlight-id]')).toBeNull();
  });
});

function renderFixture(): { savedText: Text } {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="user" data-message-id="user-1">
        <p>User message.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>The saved phrase belongs here.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-2">
        <p>Pin this complete answer for later review.</p>
      </article>
    </main>
  `;

  const savedText = document.querySelector(
    '[data-message-id="assistant-1"] p',
  )?.firstChild;

  if (!(savedText instanceof Text)) {
    throw new Error('Expected assistant text node.');
  }

  return { savedText };
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

function clickShadowButton(label: string): void {
  const button = getShadowRoot().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find button "${label}".`);
  }

  button.click();
}

function showPinButton(messageKey: string): void {
  const message = document.querySelector<HTMLElement>(
    `[data-message-id="${messageKey}"]`,
  );

  if (!message) {
    throw new Error(`Could not find message "${messageKey}".`);
  }

  message.dispatchEvent(new MouseEvent('mouseenter'));
}

function getPinButton(): HTMLButtonElement {
  const button = getShadowRoot().querySelector<HTMLButtonElement>(
    'button[aria-label="Pin assistant response"]',
  );

  if (!button) {
    throw new Error('Could not find pin button.');
  }

  return button;
}

function setMessageRect(messageKey: string, bounds: DOMRect): void {
  const message = document.querySelector<HTMLElement>(
    `[data-message-id="${messageKey}"]`,
  );

  if (!message) {
    throw new Error(`Could not find message "${messageKey}".`);
  }

  Object.defineProperty(message, 'getBoundingClientRect', {
    configurable: true,
    value: () => bounds,
  });
}

function openNotesPanel(): void {
  const panel = getShadowRoot().querySelector<HTMLElement>(
    '#sidenote-notes-panel',
  );

  if (!panel) {
    throw new Error('Notes panel was not rendered.');
  }

  if (panel.hidden) {
    clickShadowButton('Open notes panel');
  }
}

function clickNotesRow(itemType: 'annotation' | 'pin', itemId: string): void {
  const row = getNotesRow(itemType, itemId);
  const button = row.querySelector<HTMLButtonElement>(
    '.sidenote-notes-row-main',
  );

  if (!button) {
    throw new Error(`Could not find notes row for "${itemId}".`);
  }

  button.click();
}

function clickDeleteButton(
  itemType: 'annotation' | 'pin',
  itemId: string,
): void {
  const row = getNotesRow(itemType, itemId);
  const button = row.querySelector<HTMLButtonElement>(
    '.sidenote-notes-row-delete',
  );

  if (!button) {
    throw new Error(`Could not find delete button for "${itemId}".`);
  }

  button.click();
}

function getNotesRow(
  itemType: 'annotation' | 'pin',
  itemId: string,
): HTMLElement {
  const row = getShadowRoot().querySelector<HTMLElement>(
    `[data-sidenote-item-type="${itemType}"][data-sidenote-item-id="${itemId}"]`,
  );

  if (!row) {
    throw new Error(`Could not find notes row for "${itemId}".`);
  }

  return row;
}

function getNotesPanelText(): string {
  return (
    getShadowRoot().querySelector<HTMLElement>('#sidenote-notes-panel')
      ?.textContent ?? ''
  );
}

function getShadowRoot(): ShadowRoot {
  const shadowRoot = document.getElementById(
    'sidenote-overlay-root',
  )?.shadowRoot;

  if (!shadowRoot) {
    throw new Error('Overlay root was not mounted.');
  }

  return shadowRoot;
}

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(left, top, width, height);
}

function resetDomForReload(): void {
  document.body.replaceChildren();
  document.getElementById('sidenote-overlay-root')?.remove();
  document.getSelection()?.removeAllRanges();
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

function settle(delay = 20): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}
