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
  pathname: '/c/phase-4',
  href: 'https://chatgpt.com/c/phase-4',
} as Location;

describe('Phase 4 provider-backed Explain/Ask flow', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000004',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('sends Explain to a mocked provider, shows the answer in a bubble, never creates a ChatGPT composer message, and re-anchors after reload', async () => {
    const { sourceText } = renderFixture();
    const sendButtonClick = vi.fn();
    const sendMessage = createProviderMessenger();

    document
      .querySelector<HTMLButtonElement>('[data-testid="send-button"]')
      ?.addEventListener('click', sendButtonClick);

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
    await waitForBubbleText('TTL means time to live.');

    const clarifyCalls = sendMessage.mock.calls.filter(([message]) =>
      isClarifyRuntimeMessage(message),
    );

    expect(clarifyCalls).toHaveLength(1);
    const clarifyMessage = clarifyCalls[0]?.[0];

    if (!isClarifyRuntimeMessage(clarifyMessage)) {
      throw new Error('Expected clarify runtime message.');
    }

    expect(clarifyMessage).toMatchObject({
      type: 'sidenote:clarify',
      request: {
        highlightedText: 'TTL',
        question: 'What does this mean and why is it here?',
        conversationId: 'phase-4',
        messageKey: 'assistant-1',
        source: {
          site: 'chatgpt',
          url: 'https://chatgpt.com/c/phase-4',
        },
        model: 'Qwen/Qwen3-8B',
      },
    });
    expect(clarifyMessage.request.context).toContain(
      'Assistant: volatile-lru only evicts keys with TTL metadata.',
    );
    expect(clarifyMessage.request.context).not.toContain(
      'Future assistant text',
    );
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-textarea"]',
      )?.value,
    ).toBe('');
    expect(sendButtonClick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-message-id="user-side"]')).toBeNull();

    const bubble = getBubble();

    expect(bubble.textContent).toContain('Answer');
    expect(bubble.textContent).toContain('TTL means time to live.');

    setHighlightRect(new DOMRect(260, 210, 36, 20));
    window.dispatchEvent(new Event('resize'));

    expect(getBubble().style.top).toBe('238px');

    const record = await getConversation('phase-4', storageArea);
    const ask = record?.annotations[0];

    expect(ask).toMatchObject({
      kind: 'ask',
      messageKey: 'assistant-1',
      question: 'What does this mean and why is it here?',
      answerMarkdown: 'TTL means time to live.',
      answerState: 'complete',
      collapsed: false,
      provider: {
        providerId: 'sidenote-api',
        model: 'Qwen/Qwen3-8B',
        endpointLabel: 'Sidenote API',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    });
    expect(
      document.querySelector('[data-sidenote-highlight-id]')?.textContent,
    ).toBe('TTL');

    resetDomForReload();
    renderFixture();
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    expect(
      document.querySelector('[data-sidenote-highlight-id]')?.textContent,
    ).toBe('TTL');
    expect(getBubble().textContent).toContain('TTL means time to live.');
  });

  it('sends a custom Ask question to the mocked provider', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createProviderMessenger();

    vi.spyOn(window, 'prompt').mockReturnValue('Why is TTL the deciding bit?');
    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle();

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Ask');
    await acceptPrivacyDisclosure();
    await waitForBubbleText('TTL means time to live.');

    const clarifyMessage = sendMessage.mock.calls.find(([message]) =>
      isClarifyRuntimeMessage(message),
    )?.[0];

    expect(clarifyMessage).toMatchObject({
      type: 'sidenote:clarify',
      request: {
        highlightedText: 'TTL',
        question: 'Why is TTL the deciding bit?',
      },
    });
    expect(getBubble().textContent).toContain('TTL means time to live.');
  });
});

function renderFixture(): { sourceText: Text } {
  document.body.innerHTML = `
    <main id="conversation">
      <article data-message-author-role="user" data-message-id="user-1">
        <p>What does volatile-lru do?</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>volatile-lru only evicts keys with TTL metadata.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-2">
        <p>Future assistant text should not be prompt context.</p>
      </article>
    </main>
    <textarea data-testid="prompt-textarea"></textarea>
    <button data-testid="send-button" type="button">Send</button>
  `;

  const sourceText = document.querySelector(
    '[data-message-id="assistant-1"] p',
  )?.firstChild;

  if (!(sourceText instanceof Text)) {
    throw new Error('Expected assistant text node.');
  }

  return { sourceText };
}

function createProviderMessenger(): ReturnType<
  typeof vi.fn<RuntimeMessageSender>
> {
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

    setTimeout(() => {
      callback({
        ok: true,
        response: {
          answerMarkdown: 'TTL means time to live.',
          provider: {
            id: 'sidenote-api',
            model: 'Qwen/Qwen3-8B',
            endpointLabel: 'Sidenote API',
          },
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      });
    }, 20);
  });
}

function setHighlightRect(bounds: DOMRect): void {
  const highlight = document.querySelector<HTMLElement>(
    '[data-sidenote-highlight-id]',
  );

  if (!highlight) {
    throw new Error('Expected rendered highlight.');
  }

  Object.defineProperty(highlight, 'getBoundingClientRect', {
    configurable: true,
    value: () => bounds,
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

function getBubble(): HTMLElement {
  const bubble = getShadowRoot().querySelector<HTMLElement>(
    '.sidenote-ask-bubble',
  );

  if (!bubble) {
    throw new Error('Ask bubble was not rendered.');
  }

  return bubble;
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
