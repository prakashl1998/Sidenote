import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleProviderSettingsRuntimeMessage } from '../../src/background/provider-routing';
import { bootstrapContentScript } from '../../src/content';
import {
  CLARIFY_CANCEL_MESSAGE_TYPE,
  PROVIDER_STATUS_MESSAGE_TYPE,
  isClarifyCancelRuntimeMessage,
  isClarifyRuntimeMessage,
  isProviderStatusRuntimeMessage,
  requestClarification,
  requestProviderStatus,
  type RuntimeMessageSender,
} from '../../src/shared/messaging';
import {
  getConversation,
  getProviderSettings,
  type ChromeStorageAreaLike,
  updateProviderSettings,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-6',
  href: 'https://chatgpt.com/c/phase-6',
} as Location;

describe('Phase 6 hardening', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(async () => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    let uuidCounter = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${uuidCounter
        .toString()
        .padStart(12, '0')}`;
    });
    await acceptDisclosure(storageArea);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('disables only Explain and Ask during provider outage while Save, Pin, and Notes still work', async () => {
    const { sourceText, secondaryText } = renderFixture();
    const sendMessage = createHardeningMessenger({ providerHealthy: false });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    await waitForShadowText(
      'Ask is paused: the configured AI provider is unavailable. Your highlights and notes are safe.',
    );

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(getShadowButton('Explain').disabled).toBe(true);
    expect(getShadowButton('Ask').disabled).toBe(true);
    expect(getShadowButton('Save').disabled).toBe(false);

    clickShadowButton('Explain');
    clickShadowButton('Save');
    await settle();

    document
      .querySelector<HTMLElement>('[data-message-id="assistant-2"]')
      ?.dispatchEvent(new MouseEvent('mouseenter'));
    clickShadowButton('Pin assistant response');
    await settle();
    openNotesPanel();

    expect(countClarifyCalls(sendMessage)).toBe(0);
    expect(getNotesPanelText()).toContain('TTL');
    expect(getNotesPanelText()).toContain('Pin this complete answer');
    expect(
      (await getConversation('phase-6', storageArea))?.annotations,
    ).toHaveLength(1);
    expect((await getConversation('phase-6', storageArea))?.pins).toHaveLength(
      1,
    );

    selectText(secondaryText, 'pin content', rect(180, 210, 72, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(getShadowButton('Save').disabled).toBe(false);
  });

  it('recovers the degraded gate after a later provider settings refresh reports healthy', async () => {
    let providerHealthy = false;
    const { sourceText } = renderFixture();
    const sendMessage = createHardeningMessenger({
      providerHealthy: () => providerHealthy,
    });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(getShadowButton('Explain').disabled).toBe(true);

    providerHealthy = true;
    openNotesPanel();
    clickShadowButton('Open provider settings');
    await waitForShadowText('Status: Ready');

    selectText(findTextNodeContaining('TTL'), 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(getShadowButton('Explain').disabled).toBe(false);

    clickShadowButton('Explain');
    await waitForBubbleText('Provider answer.');
    expect(countClarifyCalls(sendMessage)).toBe(1);
  });

  it('shows a retryable failed bubble for provider timeouts and completes on Retry', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createHardeningMessenger({ timeoutFirst: true });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await waitForBubbleText('Provider request timed out.');

    const failedBubble = getBubble();

    expect(failedBubble.textContent).toContain('Failed');
    expect(getShadowButton('Retry side note')).toBeTruthy();

    clickShadowButton('Retry side note');
    await waitForBubbleText('Provider answer after retry.');

    expect(countClarifyCalls(sendMessage)).toBe(2);
    expect(
      (await getConversation('phase-6', storageArea))?.annotations[0],
    ).toMatchObject({
      answerState: 'complete',
      answerMarkdown: 'Provider answer after retry.',
    });
  });

  it('aborts the in-flight provider request when deleting a pending bubble', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createHardeningMessenger({ answerDelay: 400 });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await waitForBubbleText('Waiting for provider...');

    clickShadowButton('Delete side note');
    await settle(80);

    expect(
      sendMessage.mock.calls.some(([message]) =>
        isClarifyCancelRuntimeMessage(message),
      ),
    ).toBe(true);
    expect(
      (await getConversation('phase-6', storageArea))?.annotations,
    ).toEqual([]);
    expect(getShadowRoot().querySelector('.sidenote-ask-bubble')).toBeNull();
  });

  it('keeps one ask in flight and repaints highlights after message re-render', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createHardeningMessenger({ answerDelay: 160 });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    clickShadowButton('Explain');
    await waitForBubbleText('Waiting for provider...');

    expect(countClarifyCalls(sendMessage)).toBe(1);

    replaceAssistantMessageText('assistant-1', [
      'volatile-lru only evicts keys with ',
      'TTL',
      ' metadata after a render.',
    ]);
    await settle(120);

    expect(
      document.querySelector('[data-sidenote-highlight-id]')?.textContent,
    ).toBe('TTL');
    await waitForBubbleText('Provider answer.');
  });

  it('exposes accessible labels, statuses, and disabled state for hardened UI', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createHardeningMessenger({ timeoutFirst: true });

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await waitForBubbleText('Provider request timed out.');

    expect(getShadowButton('Retry side note').textContent).toBe('Retry');
    expect(getShadowButton('Collapse side note')).toBeTruthy();
    expect(getShadowButton('Delete side note')).toBeTruthy();
    expect(getBubble().getAttribute('role')).toBe('dialog');
    expect(getBubble().getAttribute('aria-label')).toBe('Side note failed');

    const outage = createHardeningMessenger({ providerHealthy: false });

    resetDom();
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage: outage,
      storageArea,
      windowRef: window,
    });
    await settle(80);
    selectText(findTextNodeContaining('TTL'), 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));

    const banner = getShadowRoot().querySelector<HTMLElement>(
      '#sidenote-provider-degraded-banner',
    );

    expect(banner?.getAttribute('role')).toBe('status');
    expect(getShadowButton('Explain').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(getShadowButton('Ask').getAttribute('aria-disabled')).toBe('true');
    expect(getShadowButton('Save').getAttribute('aria-disabled')).toBeNull();
  });

  it('times out content-to-background clarify requests and sends a cancel message', async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn<RuntimeMessageSender>((message, callback) => {
      if (message.type === CLARIFY_CANCEL_MESSAGE_TYPE) {
        callback({ ok: true });
      }
    });
    const promise = requestClarification(
      {
        highlightedText: 'TTL',
        question: 'What does this mean?',
        context: 'Assistant: TTL metadata.',
        conversationId: 'phase-6',
        messageKey: 'assistant-1',
        source: {
          site: 'chatgpt',
          url: 'https://chatgpt.com/c/phase-6',
        },
        model: 'Qwen/Qwen3-8B',
      },
      sendMessage,
      { timeoutMs: 25 },
    );
    const rejection = expect(promise).rejects.toThrow(
      'Provider request timed out.',
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(
      sendMessage.mock.calls.some(([message]) =>
        isClarifyCancelRuntimeMessage(message),
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('times out provider status requests when the background does not answer', async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn<RuntimeMessageSender>(() => undefined);
    const promise = requestProviderStatus(sendMessage, { timeoutMs: 25 });
    const rejection = expect(promise).rejects.toThrow(
      'Provider status check timed out.',
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    vi.useRealTimers();
  });

  it('times out background provider health checks even when a provider ignores abort', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
    );
    await updateProviderSettings(
      {
        ...(await getProviderSettings(storageArea)),
        activeProviderId: 'sidenote-api',
      },
      storageArea,
    );

    const promise = handleProviderSettingsRuntimeMessage(
      {
        type: PROVIDER_STATUS_MESSAGE_TYPE,
      },
      storageArea,
    );
    const result = expect(promise).resolves.toEqual({
      ok: false,
      error: 'Provider health check timed out.',
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    vi.useRealTimers();
  });
});

function createHardeningMessenger({
  providerHealthy = true,
  answerDelay = 20,
  timeoutFirst = false,
}: {
  providerHealthy?: boolean | (() => boolean);
  answerDelay?: number;
  timeoutFirst?: boolean;
} = {}): ReturnType<typeof vi.fn<RuntimeMessageSender>> {
  let clarifyCount = 0;

  return vi.fn<RuntimeMessageSender>((message, callback) => {
    if (isProviderStatusRuntimeMessage(message)) {
      const healthy =
        typeof providerHealthy === 'function'
          ? providerHealthy()
          : providerHealthy;

      callback({
        ok: true,
        status: {
          ok: healthy,
          label: healthy ? 'Ready' : 'Provider is unavailable.',
          failures: healthy ? [] : ['Provider is unavailable.'],
          settings: {
            activeProviderId: 'huggingface',
            sidenoteApiBaseUrl: 'https://api.sidenote.test',
            huggingFaceRouterBaseUrl: 'https://router.huggingface.co/v1',
            huggingFacePresetId: 'huggingface-default',
            defaultModel: 'Qwen/Qwen3-8B',
            defaultExplainQuestion: 'What does this mean and why is it here?',
            notesPanelSide: 'right',
            byokPresets: [],
            privacyDisclosureAcceptedAt: 1,
          },
        },
      });
      return;
    }

    if (isClarifyCancelRuntimeMessage(message)) {
      callback({ ok: true });
      return;
    }

    if (!isClarifyRuntimeMessage(message)) {
      callback({ ok: true });
      return;
    }

    clarifyCount += 1;
    setTimeout(() => {
      if (timeoutFirst && clarifyCount === 1) {
        callback({
          ok: false,
          error: 'Provider request timed out.',
        });
        return;
      }

      callback({
        ok: true,
        response: {
          answerMarkdown:
            clarifyCount > 1
              ? 'Provider answer after retry.'
              : 'Provider answer.',
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

function renderFixture(): { sourceText: Text; secondaryText: Text } {
  document.body.innerHTML = `
    <main id="conversation">
      <article data-message-author-role="user" data-message-id="user-1">
        <p>What does volatile-lru do?</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>volatile-lru only evicts keys with TTL metadata.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-2">
        <p>Pin this complete answer with pin content for later review.</p>
      </article>
    </main>
  `;

  return {
    sourceText: findTextNodeContaining('TTL'),
    secondaryText: findTextNodeContaining('pin content'),
  };
}

async function acceptDisclosure(
  storageArea: ChromeStorageAreaLike,
): Promise<void> {
  await updateProviderSettings(
    {
      ...(await getProviderSettings(storageArea)),
      privacyDisclosureAcceptedAt: 1,
    },
    storageArea,
  );
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
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => bounds,
  });
  Object.defineProperty(range, 'getClientRects', {
    configurable: true,
    value: () => [bounds],
  });

  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function replaceAssistantMessageText(
  messageKey: string,
  parts: [string, string, string],
): void {
  const message = document.querySelector<HTMLElement>(
    `[data-message-id="${messageKey}"]`,
  );

  if (!message) {
    throw new Error(`Could not find message "${messageKey}".`);
  }

  message.replaceChildren();
  const paragraph = document.createElement('p');
  paragraph.append(parts[0], parts[1], parts[2]);
  message.append(paragraph);
}

function clickShadowButton(label: string): void {
  getShadowButton(label).click();
}

function getShadowButton(label: string): HTMLButtonElement {
  const button = getShadowRoot().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find button "${label}".`);
  }

  return button;
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

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(left, top, width, height);
}

function resetDom(): void {
  document.body.replaceChildren();
  document.getElementById('sidenote-overlay-root')?.remove();
  document.getSelection()?.removeAllRanges();
  renderFixture();
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

function countClarifyCalls(
  sendMessage: ReturnType<typeof vi.fn<RuntimeMessageSender>>,
): number {
  return sendMessage.mock.calls.filter(([message]) =>
    isClarifyRuntimeMessage(message),
  ).length;
}

function settle(delay = 20): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function waitForBubbleText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

async function waitForShadowText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (getShadowRoot().textContent.includes(text)) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Shadow root did not contain "${text}".`);
}
