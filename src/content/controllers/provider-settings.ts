import type { ProviderSettings } from '../../shared/models';
import {
  DEFAULT_HUGGING_FACE_PRESET_ID,
  DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
} from '../../shared/providers/constants';

export const PRIVACY_DISCLOSURE_TEXT =
  'Clarifications send the highlighted text and nearby context to your configured AI provider. Saves and pins stay local.';

export interface ProviderStatusViewModel {
  ok: boolean;
  label: string;
  failures: string[];
  settings: ProviderSettings;
}

export interface ProviderSettingsHandlers {
  onRefreshStatus: () => Promise<ProviderStatusViewModel | null>;
  onOpenProviderOptions: () => void;
}

const PANEL_ID = 'sidenote-provider-settings';

export class ProviderSettingsController {
  private readonly panel: HTMLElement;
  private status: ProviderStatusViewModel | null = null;
  private open = false;

  constructor(
    private readonly shadowRoot: ShadowRoot,
    private readonly handlers: ProviderSettingsHandlers,
  ) {
    this.panel = this.shadowRoot.ownerDocument.createElement('section');
    this.panel.id = PANEL_ID;
    this.panel.setAttribute('aria-label', 'Sidenote provider settings');
    this.panel.hidden = true;
    this.shadowRoot.append(this.panel);
    this.render();
  }

  async refresh(): Promise<void> {
    this.status = await this.handlers.onRefreshStatus();
    this.render();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;

    if (open) {
      void this.refresh();
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  async showPrivacyDisclosure(): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = this.shadowRoot.ownerDocument.createElement('div');
      dialog.className = 'sidenote-privacy-disclosure';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Clarification privacy disclosure');

      const box = this.shadowRoot.ownerDocument.createElement('div');
      box.className = 'sidenote-privacy-disclosure-box';

      const message = this.shadowRoot.ownerDocument.createElement('p');
      message.textContent = PRIVACY_DISCLOSURE_TEXT;

      const controls = this.shadowRoot.ownerDocument.createElement('div');
      controls.className = 'sidenote-privacy-disclosure-controls';

      const accept = this.createButton('Continue', () => {
        dialog.remove();
        resolve(true);
      });
      const cancel = this.createButton('Cancel', () => {
        dialog.remove();
        resolve(false);
      });

      controls.append(accept, cancel);
      box.append(message, controls);
      dialog.append(box);
      this.shadowRoot.append(dialog);
      accept.focus();
    });
  }

  private render(): void {
    this.panel.replaceChildren();

    const heading = this.shadowRoot.ownerDocument.createElement('h2');
    heading.textContent = 'Provider';

    const statusLine = this.shadowRoot.ownerDocument.createElement('p');
    statusLine.className = 'sidenote-provider-status';
    statusLine.dataset.providerStatus = this.status?.ok ? 'ready' : 'blocked';
    statusLine.textContent = `Status: ${this.status?.label ?? 'Checking...'}`;

    const model = this.shadowRoot.ownerDocument.createElement('p');
    model.className = 'sidenote-provider-detail';
    model.textContent = `Model: ${
      this.status?.settings.defaultModel ?? 'Qwen/Qwen3-8B'
    }`;

    const provider = this.shadowRoot.ownerDocument.createElement('p');
    provider.className = 'sidenote-provider-detail';
    provider.textContent = `Provider: ${this.getProviderLabel()}`;

    const disclosure = this.shadowRoot.ownerDocument.createElement('p');
    disclosure.className = 'sidenote-provider-detail';
    disclosure.textContent = `Privacy disclosure: ${
      this.status?.settings.privacyDisclosureAcceptedAt
        ? 'accepted'
        : 'not accepted'
    }`;

    const explainQuestion = this.shadowRoot.ownerDocument.createElement('p');
    explainQuestion.className = 'sidenote-provider-detail';
    explainQuestion.textContent = `Explain prompt: ${
      this.status?.settings.defaultExplainQuestion ??
      'What does this mean and why is it here?'
    }`;

    const panelSide = this.shadowRoot.ownerDocument.createElement('p');
    panelSide.className = 'sidenote-provider-detail';
    panelSide.textContent = `Notes panel: ${
      this.status?.settings.notesPanelSide ?? 'right'
    } side`;

    const optionsButton = this.createButton('Open extension settings', () => {
      this.handlers.onOpenProviderOptions();
    });
    optionsButton.className = 'sidenote-provider-options-button';

    this.panel.append(
      heading,
      statusLine,
      model,
      provider,
      disclosure,
      explainQuestion,
      panelSide,
      optionsButton,
    );
  }

  private createButton(
    label: string,
    onClick: () => void | Promise<void>,
  ): HTMLButtonElement {
    const button = this.shadowRoot.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      void onClick();
    });

    return button;
  }

  private getProviderLabel(): string {
    const settings = this.status?.settings;

    if (!settings) {
      return 'Hugging Face';
    }

    if (settings.activeProviderId === 'huggingface') {
      const preset = settings.byokPresets.find(
        (candidate) =>
          candidate.id ===
          (settings.huggingFacePresetId ?? DEFAULT_HUGGING_FACE_PRESET_ID),
      );
      const baseUrl = preset?.baseUrl ?? DEFAULT_HUGGING_FACE_ROUTER_BASE_URL;

      return `Hugging Face (${baseUrl})`;
    }

    return settings.activeProviderId === 'sidenote-api'
      ? 'Sidenote API'
      : 'OpenAI-compatible preset';
  }
}
