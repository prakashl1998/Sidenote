import { afterEach, describe, expect, it } from 'vitest';

import { createChatGptAdapter } from '../../src/content/adapters/chatgpt-adapter';
import { ActionBarController } from '../../src/content/controllers/action-bar';
import { mountOverlayRoot } from '../../src/content/overlay-root';
import { SelectionController } from '../../src/content/selection';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-1',
} as Location;

describe('Phase 1 selection action bar', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getElementById('sidenote-overlay-root')?.remove();
    document.getSelection()?.removeAllRanges();
  });

  it('shows only for selections inside assistant messages', () => {
    const { assistantText, userText, shadowRoot } = renderFixture();
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const actionBar = new ActionBarController(shadowRoot);
    const controller = new SelectionController({
      adapter,
      onSelection: ({ rect }) => {
        actionBar.show(rect);
      },
      onDismiss: () => {
        actionBar.hide();
      },
    });

    selectText(assistantText, 'frobnication', rect(120, 160, 110, 24));
    controller.evaluateCurrentSelection();

    const toolbar = shadowRoot.querySelector('#sidenote-action-bar');
    expect(toolbar).toBeInstanceOf(HTMLDivElement);
    expect(toolbar?.hasAttribute('hidden')).toBe(false);
    expect(toolbar?.textContent).toBe('ExplainAskSave');

    selectText(userText, 'frobnication', rect(120, 160, 110, 24));
    controller.evaluateCurrentSelection();

    expect(toolbar?.hasAttribute('hidden')).toBe(true);
  });

  it('positions above the selection and flips below near the viewport top', () => {
    const { shadowRoot } = renderFixture();
    const actionBar = new ActionBarController(shadowRoot, window);
    const toolbar = actionBar.getElement();

    setViewport(400, 300);
    actionBar.show(rect(100, 150, 100, 20));

    expect(toolbar.dataset.placement).toBe('top');
    expect(toolbar.style.top).toBe('50px');
    expect(toolbar.style.left).toBe('112px');

    actionBar.show(rect(6, 150, 100, 20));

    expect(toolbar.dataset.placement).toBe('bottom');
    expect(toolbar.style.top).toBe('34px');
    expect(toolbar.style.left).toBe('112px');
  });

  it('uses stable fallback signals when the primary assistant-role attribute is absent', () => {
    const { assistantText, userText, shadowRoot } = renderFallbackFixture();
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const actionBar = new ActionBarController(shadowRoot);
    const controller = new SelectionController({
      adapter,
      onSelection: ({ rect }) => {
        actionBar.show(rect);
      },
      onDismiss: () => {
        actionBar.hide();
      },
    });

    selectText(assistantText, 'fallback', rect(120, 160, 110, 24));
    controller.evaluateCurrentSelection();

    expect(actionBar.isVisible()).toBe(true);

    selectText(userText, 'fallback', rect(120, 160, 110, 24));
    controller.evaluateCurrentSelection();

    expect(actionBar.isVisible()).toBe(false);
  });

  it('dismisses on Escape, scroll, and click-away', () => {
    const { assistantText, shadowRoot } = renderFixture();
    const adapter = createChatGptAdapter(CHATGPT_LOCATION, document);
    const actionBar = new ActionBarController(shadowRoot);
    const controller = new SelectionController({
      adapter,
      onSelection: ({ rect }) => {
        actionBar.show(rect);
      },
      onDismiss: () => {
        actionBar.hide();
      },
    });
    controller.connect();

    selectText(assistantText, 'frobnication', rect(120, 160, 110, 24));
    controller.evaluateCurrentSelection();
    expect(actionBar.isVisible()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(actionBar.isVisible()).toBe(false);

    controller.evaluateCurrentSelection();
    expect(actionBar.isVisible()).toBe(true);
    window.dispatchEvent(new Event('scroll'));
    expect(actionBar.isVisible()).toBe(false);

    controller.evaluateCurrentSelection();
    expect(actionBar.isVisible()).toBe(true);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(actionBar.isVisible()).toBe(false);

    controller.disconnect();
  });
});

function renderFixture(): {
  assistantText: Text;
  userText: Text;
  shadowRoot: ShadowRoot;
} {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="user" data-message-id="user-1">
        <p>The user mentions frobnication.</p>
      </article>
      <article data-message-author-role="assistant" data-message-id="assistant-1">
        <p>The assistant explains frobnication carefully.</p>
      </article>
    </main>
  `;

  const userText = getOnlyTextNode(
    document.querySelector<HTMLElement>('[data-message-id="user-1"] p'),
  );
  const assistantText = getOnlyTextNode(
    document.querySelector<HTMLElement>('[data-message-id="assistant-1"] p'),
  );

  return {
    assistantText,
    userText,
    shadowRoot: mountOverlayRoot(document),
  };
}

function renderFallbackFixture(): {
  assistantText: Text;
  userText: Text;
  shadowRoot: ShadowRoot;
} {
  document.body.innerHTML = `
    <main>
      <article data-message-id="user-fallback" aria-label="User message">
        <p>The user fallback text.</p>
      </article>
      <article data-message-id="assistant-fallback" aria-label="ChatGPT response">
        <p>The assistant fallback text.</p>
      </article>
    </main>
  `;

  const userText = getOnlyTextNode(
    document.querySelector<HTMLElement>('[data-message-id="user-fallback"] p'),
  );
  const assistantText = getOnlyTextNode(
    document.querySelector<HTMLElement>(
      '[data-message-id="assistant-fallback"] p',
    ),
  );

  return {
    assistantText,
    userText,
    shadowRoot: mountOverlayRoot(document),
  };
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

function rect(
  top: number,
  left: number,
  width: number,
  height: number,
): DOMRect {
  return new DOMRect(left, top, width, height);
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  });
}

function getOnlyTextNode(element: HTMLElement | null): Text {
  const child = element?.firstChild;

  if (!(child instanceof Text)) {
    throw new Error('Expected fixture element to contain a text node.');
  }

  return child;
}
