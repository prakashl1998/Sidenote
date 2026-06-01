import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapContentScript } from '../../src/content';
import {
  getConversation,
  type ChromeStorageAreaLike,
} from '../../src/shared/storage';
import {
  isClarifyRuntimeMessage,
  isProviderStatusRuntimeMessage,
  type RuntimeMessageSender,
} from '../../src/shared/messaging';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-4-lifecycle',
  href: 'https://chatgpt.com/c/phase-4-lifecycle',
} as Location;

describe('Phase 4 provider bubble lifecycle', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    let uuidCounter = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${uuidCounter.toString().padStart(12, '0')}`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('keeps the provider answer primary and supports collapse, expand, and delete', async () => {
    const { sourceText } = renderFixture();

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage: createProviderMessenger(),
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await acceptPrivacyDisclosure();
    await waitForBubbleText('Provider answer.');

    expect(getBubble().textContent).toContain('Provider answer.');

    openNotesPanel();
    expect(getNotesPanelText()).toContain(
      'Clarifications send highlighted text and nearby context to your configured AI provider.',
    );

    clickShadowButton('Collapse side note');
    await settle();

    expect(getShadowRoot().querySelector('.sidenote-ask-bubble')).toBeNull();
    expect(getMarker()).toBeTruthy();
    expect(
      (await getConversation('phase-4-lifecycle', storageArea))?.annotations[0]
        ?.collapsed,
    ).toBe(true);

    getMarker().click();
    await settle();

    expect(getBubble().textContent).toContain('Provider answer.');
    expect(
      (await getConversation('phase-4-lifecycle', storageArea))?.annotations[0]
        ?.collapsed,
    ).toBe(false);

    clickShadowButton('Delete side note');
    await settle();

    expect(
      (await getConversation('phase-4-lifecycle', storageArea))?.annotations,
    ).toEqual([]);
    expect(document.querySelector('[data-sidenote-highlight-id]')).toBeNull();
    expect(getShadowRoot().querySelector('.sidenote-ask-bubble')).toBeNull();
  });

  it('preserves pending bubble collapse when the provider answer completes later', async () => {
    const { sourceText } = renderFixture({
      messageId: 'assistant-pending-collapse',
    });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage: createProviderMessenger({ answerDelay: 160 }),
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await acceptPrivacyDisclosure();
    await settle(60);

    expect(getBubble().textContent).toContain('Waiting for provider...');

    clickShadowButton('Collapse side note');
    await settle(220);

    const record = await getConversation('phase-4-lifecycle', storageArea);

    expect(record?.annotations[0]).toMatchObject({
      collapsed: true,
      answerMarkdown: 'Provider answer.',
      answerState: 'complete',
    });
    expect(getShadowRoot().querySelector('.sidenote-ask-bubble')).toBeNull();
    expect(getMarker()).toBeTruthy();
  });

  it('does not recreate a pending bubble after delete while the provider request is in flight', async () => {
    const { sourceText } = renderFixture({
      messageId: 'assistant-pending-delete',
    });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage: createProviderMessenger({ answerDelay: 160 }),
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await acceptPrivacyDisclosure();
    await settle(60);

    clickShadowButton('Delete side note');
    await settle(220);

    expect(
      (await getConversation('phase-4-lifecycle', storageArea))?.annotations,
    ).toEqual([]);
    expect(document.querySelector('[data-sidenote-highlight-id]')).toBeNull();
    expect(getShadowRoot().querySelector('.sidenote-ask-bubble')).toBeNull();
  });

  it('renders failed provider state and lets Retry complete the same annotation', async () => {
    const { sourceText, secondaryText } = renderFixture({
      messageId: 'assistant-retry',
    });
    const sendMessage = createProviderMessenger({ failFirst: true });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await acceptPrivacyDisclosure();
    await settle(80);

    expect(getBubble().textContent).toContain('Failed');
    expect(getBubble().textContent).toContain('Provider is unavailable.');

    selectText(secondaryText, 'local note', rect(180, 210, 72, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Save');
    await settle();

    document
      .querySelector<HTMLElement>('[data-message-id="assistant-retry-extra"]')
      ?.dispatchEvent(new MouseEvent('mouseenter'));
    clickShadowButton('Pin assistant response');
    await settle();

    openNotesPanel();
    expect(getNotesPanelText()).toContain(
      'What does this mean and why is it here?',
    );
    expect(getNotesPanelText()).toContain('local note');
    expect(getNotesPanelText()).toContain(
      'Save and pins should keep working as a local note.',
    );
    expect(countClarifyCalls(sendMessage)).toBe(1);

    clickShadowButton('Retry side note');
    await settle(80);

    const record = await getConversation('phase-4-lifecycle', storageArea);

    expect(countClarifyCalls(sendMessage)).toBe(2);
    expect(record?.annotations).toHaveLength(2);
    expect(record?.pins).toHaveLength(1);
    expect(record?.annotations[0]).toMatchObject({
      answerMarkdown: 'Provider answer.',
      answerState: 'complete',
    });
    expect(getBubble().textContent).toContain('Provider answer.');
  });
});

function renderFixture({
  messageId = 'assistant-1',
}: {
  messageId?: string;
} = {}): { sourceText: Text; secondaryText: Text } {
  document.body.innerHTML = `
    <main id="conversation">
      <article data-message-author-role="user" data-message-id="user-1">
        <p>What does volatile-lru do?</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="${messageId}">
        <p>volatile-lru only evicts keys with TTL metadata.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="${messageId}-extra">
        <p>Save and pins should keep working as a local note.</p>
      </article>
    </main>
  `;

  const sourceText = document.querySelector(
    `[data-message-id="${messageId}"] p`,
  )?.firstChild;

  if (!(sourceText instanceof Text)) {
    throw new Error('Expected assistant text node.');
  }

  const secondaryText = document.querySelector(
    `[data-message-id="${messageId}-extra"] p`,
  )?.firstChild;

  if (!(secondaryText instanceof Text)) {
    throw new Error('Expected secondary assistant text node.');
  }

  return { sourceText, secondaryText };
}

function createProviderMessenger({
  answerDelay = 20,
  failFirst = false,
}: {
  answerDelay?: number;
  failFirst?: boolean;
} = {}): ReturnType<typeof vi.fn<RuntimeMessageSender>> {
  let callCount = 0;

  return vi.fn<RuntimeMessageSender>((message, callback) => {
    if (isProviderStatusRuntimeMessage(message)) {
      callback({
        ok: true,
        status: {
          ok: true,
          label: 'Ready',
          failures: [],
          settings: {
            activeProviderId: 'huggingface',
            sidenoteApiBaseUrl: 'https://api.sidenote.test',
            huggingFaceRouterBaseUrl: 'https://router.huggingface.co/v1',
            huggingFacePresetId: 'huggingface-default',
            defaultModel: 'Qwen/Qwen3-8B',
            defaultExplainQuestion: 'What does this mean and why is it here?',
            notesPanelSide: 'right',
            byokPresets: [],
            privacyDisclosureAcceptedAt: undefined,
          },
        },
      });
      return;
    }

    if (!isClarifyRuntimeMessage(message)) {
      callback({ ok: true });
      return;
    }

    callCount += 1;
    setTimeout(() => {
      if (failFirst && callCount === 1) {
        callback({
          ok: false,
          error: 'Provider is unavailable.',
        });
        return;
      }

      callback({
        ok: true,
        response: {
          answerMarkdown: 'Provider answer.',
          provider: {
            id: 'sidenote-api',
            model: 'Qwen/Qwen3-8B',
            endpointLabel: 'Sidenote API',
          },
        },
      });
    }, answerDelay);
  });
}

function selectText(
  textNode: Text,
  selectedText: string,
  bounds: DOMRect,
): void {
  const activeTextNode = textNode.data.includes(selectedText)
    ? textNode
    : findTextNodeContaining(selectedText);
  const start = activeTextNode.data.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(activeTextNode, start);
  range.setEnd(activeTextNode, start + selectedText.length);
  mockRangeRect(range, bounds);

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

function getBubble(): HTMLElement {
  const bubble = getShadowRoot().querySelector<HTMLElement>(
    '.sidenote-ask-bubble',
  );

  if (!bubble) {
    throw new Error('Ask bubble was not rendered.');
  }

  return bubble;
}

function getMarker(): HTMLButtonElement {
  const marker = getShadowRoot().querySelector<HTMLButtonElement>(
    '.sidenote-ask-marker',
  );

  if (!marker) {
    throw new Error('Collapsed marker was not rendered.');
  }

  return marker;
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

function countClarifyCalls(
  sendMessage: ReturnType<typeof vi.fn<RuntimeMessageSender>>,
): number {
  return sendMessage.mock.calls.filter(([message]) =>
    isClarifyRuntimeMessage(message),
  ).length;
}

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(left, top, width, height);
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

async function waitForBubbleText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      getShadowRoot()
        .querySelector<HTMLElement>('.sidenote-ask-bubble')
        ?.textContent.includes(text)
    ) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Bubble did not contain "${text}".`);
}

async function acceptPrivacyDisclosure(): Promise<void> {
  await waitForShadowButton('Continue');
  clickShadowButton('Continue');
}

async function waitForShadowButton(label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      getShadowRoot().querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      )
    ) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Button "${label}" did not appear.`);
}
