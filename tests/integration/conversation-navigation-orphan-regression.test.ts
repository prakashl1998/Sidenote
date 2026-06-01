import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapContentScript } from '../../src/content';
import {
  isProviderStatusRuntimeMessage,
  type RuntimeMessageSender,
} from '../../src/shared/messaging';
import type { StoredAnnotation } from '../../src/shared/models';
import {
  getProviderSettings,
  type ChromeStorageAreaLike,
  upsertAnnotation,
} from '../../src/shared/storage';

describe('conversation navigation and temporary unmounted highlights', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('keeps temporarily unmounted highlights in their normal Notes section', async () => {
    await upsertAnnotation(
      makeAnnotation({
        id: 'top-highlight',
        conversationId: 'scroll-thread',
        messageKey: 'assistant-top',
        exact: 'Alpha phrase',
        prefix: 'keeps ',
        suffix: ' near',
      }),
      storageArea,
    );
    renderThread([
      ['assistant-bottom', 'Only the lower virtualized message is mounted.'],
    ]);

    bootstrapContentScript({
      locationRef: makeLocation('/c/scroll-thread'),
      sendMessage: createStatusMessenger(storageArea),
      storageArea,
      windowRef: window,
    });
    await settle(100);
    openNotesPanel();

    expect(getNotesSectionText('Saved')).toContain('Alpha phrase');
    expect(getNotesSectionText("Couldn't re-locate")).not.toContain(
      'Alpha phrase',
    );
    expect(
      getShadowRoot().querySelector<HTMLElement>('#sidenote-orphan-status')
        ?.hidden,
    ).toBe(true);
  });

  it('switches records when ChatGPT navigates to a different conversation without reloading', async () => {
    const locationRef = makeLocation('/c/old-thread');

    await upsertAnnotation(
      makeAnnotation({
        id: 'old-highlight',
        conversationId: 'old-thread',
        messageKey: 'assistant-old',
        exact: 'Old phrase',
        prefix: 'contains ',
        suffix: ' here',
      }),
      storageArea,
    );
    await upsertAnnotation(
      makeAnnotation({
        id: 'new-highlight',
        conversationId: 'new-thread',
        messageKey: 'assistant-new',
        exact: 'New phrase',
        prefix: 'contains ',
        suffix: ' here',
      }),
      storageArea,
    );
    renderThread([
      ['assistant-old', 'The old thread contains Old phrase here.'],
    ]);

    bootstrapContentScript({
      locationRef,
      sendMessage: createStatusMessenger(storageArea),
      storageArea,
      windowRef: window,
    });
    await settle(100);
    openNotesPanel();

    expect(getNotesSectionText('Saved')).toContain('Old phrase');

    setLocationPath(locationRef, '/c/new-thread');
    window.history.pushState({}, '', '/c/new-thread');
    await settle(100);

    expect(getNotesSectionText('Saved')).toContain('New phrase');
    expect(getNotesSectionText('Saved')).not.toContain('Old phrase');

    renderThread([
      ['assistant-new', 'The new thread contains New phrase here.'],
    ]);
    await settle(150);

    expect(getNotesSectionText('Saved')).toContain('New phrase');
    expect(getNotesSectionText('Saved')).not.toContain('Old phrase');
    expect(getNotesSectionText("Couldn't re-locate")).not.toContain(
      'Old phrase',
    );
    expect(
      getShadowRoot().querySelector<HTMLElement>('#sidenote-orphan-status')
        ?.hidden,
    ).toBe(true);
  });

  it('ignores stale action-bar clicks after route sync clears the selection', async () => {
    const locationRef = makeLocation('/c/stale-old');

    renderThread([
      ['assistant-old', 'The old thread contains Old phrase here.'],
    ]);

    bootstrapContentScript({
      locationRef,
      sendMessage: createStatusMessenger(storageArea),
      storageArea,
      windowRef: window,
    });
    await settle(100);

    selectText(findTextNodeContaining('Old phrase'), 'Old phrase');
    document.dispatchEvent(new MouseEvent('mouseup'));

    setLocationPath(locationRef, '/c/stale-new');
    clickShadowButton('Save');
    await settle(100);

    expect(getShadowButton('Open notes panel')).toBeTruthy();
  });
});

function makeAnnotation({
  id,
  conversationId,
  messageKey,
  exact,
  prefix,
  suffix,
}: {
  id: string;
  conversationId: string;
  messageKey: string;
  exact: string;
  prefix: string;
  suffix: string;
}): StoredAnnotation {
  return {
    id,
    conversationId,
    messageKey,
    kind: 'save',
    quote: {
      exact,
      prefix,
      suffix,
    },
    position: {
      start: prefix.length,
      end: prefix.length + exact.length,
    },
    color: '#fff2a8',
    collapsed: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderThread(messages: [string, string][]): void {
  document.body.innerHTML = `
    <main id="conversation">
      ${messages
        .map(
          ([id, text]) => `
            <article data-message-author-role="assistant" data-message-id="${id}">
              <p>${text}</p>
            </article>
          `,
        )
        .join('')}
    </main>
  `;
}

function createStatusMessenger(
  storageArea: ChromeStorageAreaLike,
): ReturnType<typeof vi.fn<RuntimeMessageSender>> {
  return vi.fn<RuntimeMessageSender>((message, callback) => {
    if (isProviderStatusRuntimeMessage(message)) {
      void getProviderSettings(storageArea).then((settings) => {
        callback({
          ok: true,
          status: {
            ok: true,
            label: 'Ready',
            failures: [],
            settings,
          },
        });
      });
      return;
    }

    callback({ ok: true });
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

function getNotesSectionText(title: string): string {
  for (const section of getShadowRoot().querySelectorAll<HTMLElement>(
    '.sidenote-notes-section',
  )) {
    if (section.querySelector('h3')?.textContent === title) {
      return section.textContent;
    }
  }

  throw new Error(`Could not find Notes section "${title}".`);
}

function clickShadowButton(label: string): void {
  getShadowButton(label).click();
}

function getShadowButton(label: string): HTMLButtonElement {
  const button = getShadowRoot().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find shadow button "${label}".`);
  }

  return button;
}

function selectText(textNode: Text, selectedText: string): void {
  const start = textNode.data.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + selectedText.length);
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(120, 160, 72, 20),
  });
  Object.defineProperty(range, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(120, 160, 72, 20)],
  });

  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function findTextNodeContaining(selectedText: string): Text {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node instanceof Text && node.data.includes(selectedText)) {
      return node;
    }
  }

  throw new Error(`Could not find selectable text "${selectedText}".`);
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

function makeLocation(pathname: string): Location {
  return {
    hostname: 'chatgpt.com',
    pathname,
    href: `https://chatgpt.com${pathname}`,
  } as Location;
}

function setLocationPath(locationRef: Location, pathname: string): void {
  const mutableLocation = locationRef as unknown as {
    pathname: string;
    href: string;
  };

  mutableLocation.pathname = pathname;
  mutableLocation.href = `https://chatgpt.com${pathname}`;
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
