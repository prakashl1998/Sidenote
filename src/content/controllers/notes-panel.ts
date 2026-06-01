import type {
  ConversationRecord,
  PinnedResponse,
  ProviderSettings,
  StoredAnnotation,
} from '../../shared/models';

const PANEL_ID = 'sidenote-notes-panel';
const TOGGLE_ID = 'sidenote-notes-toggle';
type NotesPanelSide = ProviderSettings['notesPanelSide'];

export interface NotesPanelHandlers {
  onNavigateAnnotation: (annotation: StoredAnnotation) => void;
  onDeleteAnnotation: (annotation: StoredAnnotation) => void;
  onNavigatePin: (pin: PinnedResponse) => void;
  onDeletePin: (pin: PinnedResponse) => void;
  onOpenProviderSettings: () => void;
  onTogglePanelSide: (side: NotesPanelSide) => void;
}

export class NotesPanelController {
  private readonly toggleButton: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private orphanedAnnotationIds = new Set<string>();
  private open = false;
  private side: NotesPanelSide = 'right';

  constructor(
    private readonly shadowRoot: ShadowRoot,
    private readonly handlers: NotesPanelHandlers,
  ) {
    this.toggleButton = this.createToggleButton();
    this.panel = this.shadowRoot.ownerDocument.createElement('aside');
    this.panel.id = PANEL_ID;
    this.panel.setAttribute('aria-label', 'Sidenote notes panel');
    this.panel.hidden = true;
    this.shadowRoot.append(this.toggleButton, this.panel);
    this.applySide();
    this.render(null, new Set());
  }

  render(
    record: ConversationRecord | null,
    orphanedAnnotationIds: Set<string>,
  ): void {
    this.orphanedAnnotationIds = new Set(orphanedAnnotationIds);
    this.panel.replaceChildren();

    const title = this.shadowRoot.ownerDocument.createElement('h2');
    title.textContent = 'Notes';
    const limitation = this.shadowRoot.ownerDocument.createElement('p');
    limitation.className = 'sidenote-limitation';
    limitation.textContent =
      'Clarifications send highlighted text and nearby context to your configured AI provider. Saves and pins stay local.';
    const providerSettings =
      this.shadowRoot.ownerDocument.createElement('button');
    providerSettings.type = 'button';
    providerSettings.className = 'sidenote-provider-settings-button';
    providerSettings.textContent = 'Provider settings';
    providerSettings.setAttribute('aria-label', 'Open provider settings');
    providerSettings.addEventListener('click', () => {
      this.handlers.onOpenProviderSettings();
    });
    const sideToggle = this.shadowRoot.ownerDocument.createElement('button');
    sideToggle.type = 'button';
    sideToggle.className = 'sidenote-panel-side-button';
    this.updateSideToggleButton(sideToggle);
    sideToggle.addEventListener('click', () => {
      const nextSide = this.side === 'right' ? 'left' : 'right';
      this.setPanelSide(nextSide);
      this.updateSideToggleButton(sideToggle);
      this.handlers.onTogglePanelSide(nextSide);
    });
    this.panel.append(title, limitation, providerSettings, sideToggle);

    const annotations = record?.annotations ?? [];
    const questions = annotations.filter(
      (annotation) =>
        annotation.kind === 'ask' &&
        !this.orphanedAnnotationIds.has(annotation.id),
    );
    const saved = annotations.filter(
      (annotation) =>
        annotation.kind === 'save' &&
        !this.orphanedAnnotationIds.has(annotation.id),
    );
    const orphaned = annotations.filter((annotation) =>
      this.orphanedAnnotationIds.has(annotation.id),
    );

    this.panel.append(
      this.createAnnotationSection('Questions', questions),
      this.createAnnotationSection('Saved', saved),
      this.createPinSection('Pinned', record?.pins ?? []),
      this.createAnnotationSection("Couldn't re-locate", orphaned),
    );
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggleButton.setAttribute('aria-expanded', String(open));
  }

  isOpen(): boolean {
    return this.open;
  }

  getPanelElement(): HTMLElement {
    return this.panel;
  }

  setPanelSide(side: NotesPanelSide): void {
    this.side = side;
    this.applySide();
  }

  private createToggleButton(): HTMLButtonElement {
    const button = this.shadowRoot.ownerDocument.createElement('button');
    button.id = TOGGLE_ID;
    button.type = 'button';
    button.textContent = 'Notes';
    button.setAttribute('aria-label', 'Open notes panel');
    button.setAttribute('aria-controls', PANEL_ID);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      this.setOpen(!this.open);
    });

    return button;
  }

  private applySide(): void {
    this.panel.dataset.panelSide = this.side;
    this.toggleButton.dataset.panelSide = this.side;
  }

  private updateSideToggleButton(button: HTMLButtonElement): void {
    const label =
      this.side === 'right' ? 'Move panel left' : 'Move panel right';

    button.textContent = label;
    button.setAttribute('aria-label', label);
  }

  private createAnnotationSection(
    title: string,
    annotations: StoredAnnotation[],
  ): HTMLElement {
    const section = this.createSection(title);

    if (annotations.length === 0) {
      section.append(this.createEmptyRow());
      return section;
    }

    const list = this.shadowRoot.ownerDocument.createElement('ul');
    list.className = 'sidenote-notes-list';

    for (const annotation of annotations) {
      const row = this.createRow({
        itemId: annotation.id,
        itemType: 'annotation',
        text: this.getAnnotationLabel(annotation),
        onNavigate: () => {
          this.handlers.onNavigateAnnotation(annotation);
        },
        onDelete: () => {
          this.handlers.onDeleteAnnotation(annotation);
        },
      });
      list.append(row);
    }

    section.append(list);
    return section;
  }

  private createPinSection(title: string, pins: PinnedResponse[]): HTMLElement {
    const section = this.createSection(title);

    if (pins.length === 0) {
      section.append(this.createEmptyRow());
      return section;
    }

    const list = this.shadowRoot.ownerDocument.createElement('ul');
    list.className = 'sidenote-notes-list';

    for (const pin of pins) {
      const row = this.createRow({
        itemId: pin.id,
        itemType: 'pin',
        text: pin.label ?? truncate(pin.excerptMarkdown, 96),
        onNavigate: () => {
          this.handlers.onNavigatePin(pin);
        },
        onDelete: () => {
          this.handlers.onDeletePin(pin);
        },
      });
      list.append(row);
    }

    section.append(list);
    return section;
  }

  private createSection(title: string): HTMLElement {
    const section = this.shadowRoot.ownerDocument.createElement('section');
    section.className = 'sidenote-notes-section';

    const heading = this.shadowRoot.ownerDocument.createElement('h3');
    heading.textContent = title;
    section.append(heading);

    return section;
  }

  private createRow(options: {
    itemId: string;
    itemType: 'annotation' | 'pin';
    text: string;
    onNavigate: () => void;
    onDelete: () => void;
  }): HTMLLIElement {
    const row = this.shadowRoot.ownerDocument.createElement('li');
    row.dataset.sidenoteItemType = options.itemType;
    row.dataset.sidenoteItemId = options.itemId;

    const navigate = this.shadowRoot.ownerDocument.createElement('button');
    navigate.type = 'button';
    navigate.className = 'sidenote-notes-row-main';
    navigate.textContent = options.text;
    navigate.addEventListener('click', options.onNavigate);

    const remove = this.shadowRoot.ownerDocument.createElement('button');
    remove.type = 'button';
    remove.className = 'sidenote-notes-row-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${options.text}`);
    remove.addEventListener('click', options.onDelete);

    row.append(navigate, remove);
    return row;
  }

  private createEmptyRow(): HTMLParagraphElement {
    const empty = this.shadowRoot.ownerDocument.createElement('p');
    empty.className = 'sidenote-notes-empty';
    empty.textContent = 'None yet';
    return empty;
  }

  private getAnnotationLabel(annotation: StoredAnnotation): string {
    if (annotation.kind === 'ask') {
      return truncate(annotation.question ?? annotation.quote.exact, 96);
    }

    return truncate(annotation.quote.exact, 96);
  }
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}
