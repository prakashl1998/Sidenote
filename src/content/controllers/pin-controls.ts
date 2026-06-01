import type { AssistantMessageRef } from '../adapters/types';

const PIN_CONTROLS_ID = 'sidenote-pin-controls';

export interface PinControlsHandlers {
  onPinMessage: (message: AssistantMessageRef) => void;
}

export class PinControlsController {
  private readonly container: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private activeMessage: AssistantMessageRef | null = null;
  private cleanupListeners: (() => void)[] = [];

  constructor(
    private readonly shadowRoot: ShadowRoot,
    private readonly handlers: PinControlsHandlers,
  ) {
    this.container = this.shadowRoot.ownerDocument.createElement('div');
    this.container.id = PIN_CONTROLS_ID;
    this.button = this.createPinButton();
    this.container.append(this.button);
    this.shadowRoot.append(this.container);
  }

  render(messages: AssistantMessageRef[]): void {
    this.clearMessageListeners();

    for (const message of messages) {
      const show = (): void => {
        this.showForMessage(message);
      };

      message.element.addEventListener('mouseenter', show);
      message.element.addEventListener('focusin', show);
      this.cleanupListeners.push(() => {
        message.element.removeEventListener('mouseenter', show);
        message.element.removeEventListener('focusin', show);
      });
    }

    const refreshedActiveMessage = messages.find(
      (message) => message.messageKey === this.activeMessage?.messageKey,
    );

    if (refreshedActiveMessage) {
      this.showForMessage(refreshedActiveMessage);
      return;
    }

    this.hide();
  }

  refreshPosition(): void {
    if (!this.activeMessage || this.button.hidden) {
      return;
    }

    this.positionButton(this.activeMessage);
  }

  private createPinButton(): HTMLButtonElement {
    const button = this.shadowRoot.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'sidenote-pin-button';
    button.textContent = 'Pin';
    button.hidden = true;
    button.setAttribute('aria-label', 'Pin assistant response');
    button.addEventListener('click', () => {
      if (this.activeMessage) {
        this.handlers.onPinMessage(this.activeMessage);
      }
    });

    return button;
  }

  private showForMessage(message: AssistantMessageRef): void {
    this.activeMessage = message;
    this.button.dataset.sidenoteMessageKey = message.messageKey;
    this.button.hidden = false;
    this.positionButton(message);
  }

  private hide(): void {
    this.activeMessage = null;
    this.button.hidden = true;
    delete this.button.dataset.sidenoteMessageKey;
  }

  private positionButton(message: AssistantMessageRef): void {
    const rect = message.element.getBoundingClientRect();
    const viewportHeight =
      this.shadowRoot.ownerDocument.defaultView?.innerHeight ?? 0;

    if (rect.bottom < 0 || rect.top > viewportHeight) {
      this.button.hidden = true;
      return;
    }

    this.button.hidden = false;
    this.button.style.top = `${String(Math.max(8, Math.round(rect.top + 8)))}px`;
    this.button.style.left = `${String(
      Math.max(8, Math.round(rect.right - 52)),
    )}px`;
  }

  private clearMessageListeners(): void {
    for (const cleanup of this.cleanupListeners) {
      cleanup();
    }

    this.cleanupListeners = [];
  }
}
