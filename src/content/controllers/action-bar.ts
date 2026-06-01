const ACTION_BAR_ID = 'sidenote-action-bar';
const ACTION_BAR_WIDTH = 176;
const ACTION_BAR_HEIGHT = 42;
const ACTION_BAR_GAP = 8;
const VIEWPORT_MARGIN = 8;

export interface ActionBarHandlers {
  onExplain?: () => void;
  onAsk?: () => void;
  onSave?: () => void;
}

export class ActionBarController {
  private readonly element: HTMLDivElement;
  private readonly explainButton: HTMLButtonElement;
  private readonly askButton: HTMLButtonElement;

  constructor(
    private readonly shadowRoot: ShadowRoot,
    private readonly windowRef: Window = window,
    private readonly handlers: ActionBarHandlers = {},
  ) {
    this.explainButton = this.createButton('Explain', () => {
      this.handlers.onExplain?.();
    });
    this.askButton = this.createButton('Ask', () => {
      this.handlers.onAsk?.();
    });
    this.element = this.createElement();
    this.shadowRoot.append(this.element);
    this.hide();
  }

  show(selectionRect: DOMRect): void {
    const placement =
      selectionRect.top - ACTION_BAR_HEIGHT - ACTION_BAR_GAP < 0
        ? 'bottom'
        : 'top';
    const unclampedLeft =
      selectionRect.left + selectionRect.width / 2 - ACTION_BAR_WIDTH / 2;
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      this.windowRef.innerWidth - ACTION_BAR_WIDTH - VIEWPORT_MARGIN,
    );
    const left = Math.min(Math.max(VIEWPORT_MARGIN, unclampedLeft), maxLeft);
    const top =
      placement === 'top'
        ? Math.max(
            VIEWPORT_MARGIN,
            selectionRect.top - ACTION_BAR_HEIGHT - ACTION_BAR_GAP,
          )
        : Math.min(
            this.windowRef.innerHeight - ACTION_BAR_HEIGHT - VIEWPORT_MARGIN,
            selectionRect.bottom + ACTION_BAR_GAP,
          );

    this.element.hidden = false;
    this.element.dataset.placement = placement;
    this.element.style.left = `${String(Math.round(left))}px`;
    this.element.style.top = `${String(Math.round(top))}px`;
  }

  hide(): void {
    this.element.hidden = true;
    this.element.removeAttribute('data-placement');
  }

  isVisible(): boolean {
    return !this.element.hidden;
  }

  containsEvent(event: Event): boolean {
    return event.composedPath().includes(this.element);
  }

  getElement(): HTMLDivElement {
    return this.element;
  }

  setAskEnabled(enabled: boolean, reason?: string): void {
    for (const button of [this.explainButton, this.askButton]) {
      button.disabled = !enabled;
      button.setAttribute('aria-disabled', String(!enabled));

      if (enabled) {
        button.removeAttribute('title');
      } else {
        button.title = reason ?? 'Ask is paused.';
      }
    }
  }

  private createElement(): HTMLDivElement {
    const element = this.shadowRoot.ownerDocument.createElement('div');
    element.id = ACTION_BAR_ID;
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Sidenote selection actions');
    element.append(
      this.explainButton,
      this.askButton,
      this.createButton('Save', () => {
        this.handlers.onSave?.();
      }),
    );

    return element;
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.shadowRoot.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);

    return button;
  }
}
