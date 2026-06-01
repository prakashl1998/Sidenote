import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleProviderSettingsRuntimeMessage } from '../../src/background/provider-routing';
import { bootstrapContentScript } from '../../src/content';
import { renderProviderOptionsPage } from '../../src/options/provider-options-page';
import {
  isClarifyRuntimeMessage,
  isProviderOptionsOpenRuntimeMessage,
  isProviderStatusRuntimeMessage,
  type RuntimeMessageSender,
} from '../../src/shared/messaging';
import { DEFAULT_HUGGING_FACE_PRESET_ID } from '../../src/shared/providers/constants';
import {
  getConversation,
  getProviderSecret,
  getProviderSettings,
  setProviderSecret,
  type ChromeStorageAreaLike,
  updateProviderSettings,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-5',
  href: 'https://chatgpt.com/c/phase-5',
} as Location;

describe('Phase 5 provider settings and privacy disclosure', () => {
  let storageArea: ChromeStorageAreaLike;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    let uuidCounter = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${uuidCounter
        .toString()
        .padStart(12, '0')}`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('requires first-use disclosure acceptance before Explain sends a provider request', async () => {
    await setProviderSecret(
      DEFAULT_HUGGING_FACE_PRESET_ID,
      'hf_phase5_ready_secret',
      storageArea,
    );
    const { sourceText } = renderFixture();
    const sendMessage = createPhase5Messenger(storageArea);

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
    await waitForShadowText(
      'Clarifications send the highlighted text and nearby context to your configured AI provider. Saves and pins stay local.',
    );

    expect(countClarifyCalls(sendMessage)).toBe(0);

    clickShadowButton('Continue');
    await waitForBubbleText('Provider says TTL means time to live.');

    expect(countClarifyCalls(sendMessage)).toBe(1);
    expect(
      typeof (await getProviderSettings(storageArea))
        .privacyDisclosureAcceptedAt,
    ).toBe('number');
  });

  it('opens provider status from Notes and keeps token entry in the extension options page', async () => {
    renderFixture();
    const sendMessage = createPhase5Messenger(storageArea);

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    openNotesPanel();
    clickShadowButton('Open provider settings');
    await waitForShadowText('Status: Hugging Face token required.');

    expect(getShadowRoot().querySelector('input[type="password"]')).toBeNull();

    clickShadowButton('Open extension settings');

    expect(
      sendMessage.mock.calls.some(([message]) =>
        isProviderOptionsOpenRuntimeMessage(message),
      ),
    ).toBe(true);

    renderProviderOptionsPage({ documentRef: document, storageArea });
    await waitForDocumentText('Status: Hugging Face token required.');

    const tokenInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Hugging Face token"]',
    );

    if (!tokenInput) {
      throw new Error('Expected Hugging Face token input in options page.');
    }

    tokenInput.value = 'hf_phase5_secret';
    clickDocumentButton('Save token');
    await waitForDocumentText('Status: Ready');
    expect(
      await getProviderSecret(DEFAULT_HUGGING_FACE_PRESET_ID, storageArea),
    ).toBe('hf_phase5_secret');
    expect(
      JSON.stringify(await getProviderSettings(storageArea)),
    ).not.toContain('hf_phase5_secret');

    clickDocumentButton('Remove token');
    await waitForDocumentText('Status: Hugging Face token required.');

    expect(
      await getProviderSecret(DEFAULT_HUGGING_FACE_PRESET_ID, storageArea),
    ).toBeNull();
  });

  it('sends the configured model and stores returned provider metadata on completed ask annotations', async () => {
    const settings = await getProviderSettings(storageArea);

    await updateProviderSettings(
      {
        ...settings,
        defaultModel: 'Qwen/Qwen3-8B-custom',
        byokPresets: settings.byokPresets.map((preset) =>
          preset.id === DEFAULT_HUGGING_FACE_PRESET_ID
            ? {
                ...preset,
                model: 'Qwen/Qwen3-8B-custom',
                updatedAt: 55,
              }
            : preset,
        ),
        privacyDisclosureAcceptedAt: 44,
      },
      storageArea,
    );
    await setProviderSecret(
      DEFAULT_HUGGING_FACE_PRESET_ID,
      'hf_phase5_ready_secret',
      storageArea,
    );

    const { sourceText } = renderFixture();
    const sendMessage = createPhase5Messenger(storageArea);

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
    await waitForBubbleText('Provider says TTL means time to live.');

    const clarifyCall = sendMessage.mock.calls.find(([message]) =>
      isClarifyRuntimeMessage(message),
    );

    expect(clarifyCall?.[0]).toMatchObject({
      request: {
        model: 'Qwen/Qwen3-8B-custom',
      },
    });

    const ask = (await getConversation('phase-5', storageArea))?.annotations[0];

    expect(ask).toMatchObject({
      answerState: 'complete',
      provider: {
        providerId: 'huggingface',
        model: 'Qwen/Qwen3-8B-custom',
        endpointLabel: 'Hugging Face',
      },
    });
  });

  it('does not persist unsafe provider metadata labels from completed asks', async () => {
    await updateProviderSettings(
      {
        ...(await getProviderSettings(storageArea)),
        privacyDisclosureAcceptedAt: 44,
      },
      storageArea,
    );
    await setProviderSecret(
      DEFAULT_HUGGING_FACE_PRESET_ID,
      'hf_phase5_ready_secret',
      storageArea,
    );

    const { sourceText } = renderFixture();
    const sendMessage = createPhase5Messenger(storageArea, {
      unsafeMetadata: true,
    });

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
    await waitForBubbleText('Provider says TTL means time to live.');

    const ask = (await getConversation('phase-5', storageArea))?.annotations[0];

    expect(ask?.provider).toEqual({
      providerId: 'huggingface',
      model: undefined,
      endpointLabel: undefined,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    });
  });
});

function createPhase5Messenger(
  storageArea: ChromeStorageAreaLike,
  options: { unsafeMetadata?: boolean } = {},
): ReturnType<typeof vi.fn<RuntimeMessageSender>> {
  return vi.fn<RuntimeMessageSender>((message, callback) => {
    if (
      isProviderStatusRuntimeMessage(message) ||
      isProviderOptionsOpenRuntimeMessage(message)
    ) {
      void handleProviderSettingsRuntimeMessage(message, storageArea).then(
        (response) => {
          callback(response ?? { ok: true });
        },
      );
      return;
    }

    if (isClarifyRuntimeMessage(message)) {
      setTimeout(() => {
        callback({
          ok: true,
          response: {
            answerMarkdown: 'Provider says TTL means time to live.',
            provider: {
              id: 'huggingface',
              model: options.unsafeMetadata
                ? 'hf_1234567890abcdefSECRET'
                : message.request.model,
              endpointLabel: options.unsafeMetadata
                ? 'Bearer hf_1234567890abcdefSECRET'
                : 'Hugging Face',
            },
            usage: {
              inputTokens: options.unsafeMetadata ? -1 : 15,
              outputTokens: options.unsafeMetadata ? Number.NaN : 7,
              totalTokens: options.unsafeMetadata ? Infinity : 22,
            },
          },
        });
      }, 20);
      return;
    }

    callback({ ok: true });
  });
}

function renderFixture(): { sourceText: Text } {
  document.body.innerHTML = `
    <main id="conversation">
      <article data-message-author-role="user" data-message-id="user-1">
        <p>What does volatile-lru do?</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>volatile-lru only evicts keys with TTL metadata.</p>
      </article>
    </main>
  `;

  const sourceText = document.querySelector(
    '[data-message-id="assistant-1"] p',
  )?.firstChild;

  if (!(sourceText instanceof Text)) {
    throw new Error('Expected assistant text node.');
  }

  return { sourceText };
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

function clickShadowButton(label: string): void {
  const button = getShadowRoot().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find button "${label}".`);
  }

  button.click();
}

function clickDocumentButton(label: string): void {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find document button "${label}".`);
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

function countClarifyCalls(
  sendMessage: ReturnType<typeof vi.fn<RuntimeMessageSender>>,
): number {
  return sendMessage.mock.calls.filter(([message]) =>
    isClarifyRuntimeMessage(message),
  ).length;
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

async function waitForShadowText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getShadowRoot().textContent.includes(text)) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Shadow root did not contain "${text}".`);
}

async function waitForDocumentText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.body.textContent.includes(text)) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Document did not contain "${text}".`);
}
