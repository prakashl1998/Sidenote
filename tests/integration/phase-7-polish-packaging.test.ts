import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapContentScript } from '../../src/content';
import { renderProviderOptionsPage } from '../../src/options/provider-options-page';
import {
  DEFAULT_EXPLAIN_QUESTION,
  DEFAULT_HUGGING_FACE_PRESET_ID,
} from '../../src/shared/providers/constants';
import {
  isClarifyRuntimeMessage,
  isProviderOptionsOpenRuntimeMessage,
  isProviderStatusRuntimeMessage,
  type RuntimeMessageSender,
} from '../../src/shared/messaging';
import {
  getConversation,
  getProviderSecret,
  getProviderSettings,
  setProviderSecret,
  type ChromeStorageAreaLike,
  updateProviderSettings,
  upsertAnnotation,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-7',
  href: 'https://chatgpt.com/c/phase-7',
} as Location;

describe('Phase 7 polish and packaging', () => {
  let storageArea: ChromeStorageAreaLike;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storageArea = createMemoryStorage();
    vi.stubGlobal('chrome', { runtime: {} });
    consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
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
    document.head.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('persists polished settings, clears notes data, and resets provider secrets from options', async () => {
    await upsertAnnotation(makeSavedAnnotation(), storageArea);
    await setProviderSecret(
      DEFAULT_HUGGING_FACE_PRESET_ID,
      'hf_phase7_secret',
      storageArea,
    );

    renderProviderOptionsPage({ documentRef: document, storageArea });
    await waitForDocumentText('Notes panel: right side');

    clickDocumentButton('Use left notes panel');
    await waitForDocumentText('Notes panel: left side');

    getDocumentInput('Default Explain question').value =
      'Explain this for a product manager.';
    clickDocumentButton('Save default Explain question');
    await settle();

    expect(await getProviderSettings(storageArea)).toMatchObject({
      notesPanelSide: 'left',
      defaultExplainQuestion: 'Explain this for a product manager.',
    });

    clickDocumentButton('Clear notes data');
    await waitForDocumentText('Status: Local notes data cleared.');
    expect(await getConversation('phase-7', storageArea)).toBeNull();
    expect(
      await getProviderSecret(DEFAULT_HUGGING_FACE_PRESET_ID, storageArea),
    ).toBe('hf_phase7_secret');

    clickDocumentButton('Reset provider settings');
    await waitForDocumentText('Notes panel: right side');

    expect(await getProviderSettings(storageArea)).toMatchObject({
      notesPanelSide: 'right',
      defaultExplainQuestion: DEFAULT_EXPLAIN_QUESTION,
    });
    expect(
      await getProviderSecret(DEFAULT_HUGGING_FACE_PRESET_ID, storageArea),
    ).toBeNull();
  });

  it('runs fresh install-to-use without console errors or same-thread ChatGPT messages', async () => {
    const { sourceText } = renderFixture();
    const sendMessage = createPhase7Messenger(storageArea);
    const initialArticles = Array.from(document.querySelectorAll('article'));

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
    await waitForShadowText('Clarifications send the highlighted text');

    expect(countClarifyCalls(sendMessage)).toBe(0);

    clickShadowButton('Continue');
    await waitForBubbleText('Phase 7 provider answer.');

    expect(consoleError).not.toHaveBeenCalled();
    expect(Array.from(document.querySelectorAll('article'))).toEqual(
      initialArticles,
    );
    expect(
      sendMessage.mock.calls.find(([message]) =>
        isClarifyRuntimeMessage(message),
      )?.[0],
    ).toMatchObject({
      request: {
        question: DEFAULT_EXPLAIN_QUESTION,
      },
    });
  });

  it('uses the customized Explain question and notes panel side in content UI', async () => {
    await updateProviderSettings(
      {
        ...(await getProviderSettings(storageArea)),
        defaultExplainQuestion: 'Explain this like a release note.',
        notesPanelSide: 'left',
        privacyDisclosureAcceptedAt: 1,
      },
      storageArea,
    );
    const { sourceText } = renderFixture();
    const sendMessage = createPhase7Messenger(storageArea);

    bootstrapContentScript({
      locationRef: CHATGPT_LOCATION,
      sendMessage,
      storageArea,
      windowRef: window,
    });
    await settle(80);

    openNotesPanel();
    expect(
      getShadowRoot().querySelector<HTMLElement>('#sidenote-notes-panel')
        ?.dataset.panelSide,
    ).toBe('left');

    selectText(sourceText, 'TTL', rect(120, 160, 36, 20));
    document.dispatchEvent(new MouseEvent('mouseup'));
    clickShadowButton('Explain');
    await waitForBubbleText('Phase 7 provider answer.');

    expect(
      sendMessage.mock.calls.find(([message]) =>
        isClarifyRuntimeMessage(message),
      )?.[0],
    ).toMatchObject({
      request: {
        question: 'Explain this like a release note.',
      },
    });

    clickShadowButton('Move panel right');
    await settle();
    expect((await getProviderSettings(storageArea)).notesPanelSide).toBe(
      'right',
    );
    expect(getShadowButton('Move panel left')).toBeTruthy();
  });

  it('ships store listing, privacy copy, and a green manual QA checklist', async () => {
    const [storeListing, privacy, manualQa] = await Promise.all([
      readFile('docs/STORE_LISTING.md', 'utf8'),
      readFile('docs/PRIVACY.md', 'utf8'),
      readFile('tests/MANUAL_QA.md', 'utf8'),
    ]);

    expect(storeListing).toContain('Chrome Web Store Listing Draft');
    expect(storeListing).toContain('does not request broad `<all_urls>`');
    expect(privacy).toContain('does not create hidden ChatGPT prompts');
    expect(manualQa).toContain('Status: green');
    expect(manualQa).toContain(
      '[x] Explain and Ask do not insert ChatGPT same-thread messages.',
    );
  });
});

function createPhase7Messenger(
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

    if (isProviderOptionsOpenRuntimeMessage(message)) {
      callback({ ok: true });
      return;
    }

    if (isClarifyRuntimeMessage(message)) {
      setTimeout(() => {
        callback({
          ok: true,
          response: {
            answerMarkdown: 'Phase 7 provider answer.',
            provider: {
              id: 'huggingface',
              model: message.request.model,
              endpointLabel: 'Hugging Face',
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

  return { sourceText: findTextNodeContaining('TTL') };
}

function makeSavedAnnotation() {
  return {
    id: 'saved-phase-7',
    conversationId: 'phase-7',
    messageKey: 'assistant-1',
    kind: 'save' as const,
    quote: {
      exact: 'TTL',
      prefix: 'keys with ',
      suffix: ' metadata',
    },
    position: {
      start: 34,
      end: 37,
    },
    color: '#fff2a8',
    collapsed: true,
    createdAt: 1,
    updatedAt: 1,
  };
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

function clickDocumentButton(label: string): void {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );

  if (!button) {
    throw new Error(`Could not find document button "${label}".`);
  }

  button.click();
}

function getDocumentInput(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );

  if (!input) {
    throw new Error(`Could not find input "${label}".`);
  }

  return input;
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

function createMemoryStorage(): ChromeStorageAreaLike {
  const values = new Map<string, unknown>();

  return {
    get(keys, callback) {
      if (keys === null) {
        callback(Object.fromEntries(values));
        return;
      }

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
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (
      getShadowRoot()
        .querySelector<HTMLElement>('.sidenote-ask-bubble')
        ?.textContent.includes(text)
    ) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Timed out waiting for bubble text "${text}".`);
}

async function waitForShadowText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (getShadowRoot().textContent.includes(text)) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Timed out waiting for shadow text "${text}".`);
}

async function waitForDocumentText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (document.body.textContent.includes(text)) {
      return;
    }

    await settle(25);
  }

  throw new Error(`Timed out waiting for document text "${text}".`);
}
