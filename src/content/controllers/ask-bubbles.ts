import type { StoredAnnotation } from '../../shared/models';

const BUBBLE_LAYER_ID = 'sidenote-ask-bubbles';
const BUBBLE_WIDTH = 300;
const VIEWPORT_MARGIN = 12;

export interface AskBubbleHandlers {
  onCollapse: (annotation: StoredAnnotation) => void;
  onExpand: (annotation: StoredAnnotation) => void;
  onDelete: (annotation: StoredAnnotation) => void;
  onRetry?: (annotation: StoredAnnotation) => void;
}

export class AskBubblesController {
  private readonly layer: HTMLDivElement;
  private annotations: StoredAnnotation[] = [];
  private orphanedAnnotationIds = new Set<string>();

  constructor(
    private readonly shadowRoot: ShadowRoot,
    private readonly handlers: AskBubbleHandlers,
    private readonly windowRef: Window = window,
  ) {
    this.layer = this.shadowRoot.ownerDocument.createElement('div');
    this.layer.id = BUBBLE_LAYER_ID;
    this.shadowRoot.append(this.layer);
  }

  render(
    annotations: StoredAnnotation[],
    orphanedAnnotationIds: Set<string>,
  ): void {
    this.annotations = annotations;
    this.orphanedAnnotationIds = new Set(orphanedAnnotationIds);
    this.layer.replaceChildren();

    for (const annotation of this.annotations) {
      if (
        annotation.kind !== 'ask' ||
        this.orphanedAnnotationIds.has(annotation.id)
      ) {
        continue;
      }

      const source = findHighlightElement(
        this.shadowRoot.ownerDocument,
        annotation.id,
      );

      if (!source) {
        continue;
      }

      this.layer.append(
        annotation.collapsed
          ? this.createCollapsedMarker(annotation, source)
          : this.createBubble(annotation, source),
      );
    }
  }

  refreshPosition(): void {
    this.render(this.annotations, this.orphanedAnnotationIds);
  }

  private createBubble(
    annotation: StoredAnnotation,
    source: HTMLElement,
  ): HTMLDivElement {
    const bubble = this.shadowRoot.ownerDocument.createElement('div');
    const rect = source.getBoundingClientRect();
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, this.windowRef.innerWidth - BUBBLE_WIDTH),
    );
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.bottom + 8),
      Math.max(VIEWPORT_MARGIN, this.windowRef.innerHeight - 90),
    );

    bubble.className = 'sidenote-ask-bubble';
    bubble.dataset.sidenoteBubbleId = annotation.id;
    bubble.setAttribute(
      'role',
      annotation.answerState === 'pending' ? 'status' : 'dialog',
    );
    bubble.setAttribute('aria-label', getBubbleAriaLabel(annotation));
    bubble.setAttribute(
      'aria-live',
      annotation.answerState === 'pending' ? 'polite' : 'off',
    );
    bubble.style.left = `${String(Math.round(left))}px`;
    bubble.style.top = `${String(Math.round(top))}px`;

    const header = this.shadowRoot.ownerDocument.createElement('div');
    header.className = 'sidenote-ask-bubble-header';

    const status = this.shadowRoot.ownerDocument.createElement('div');
    status.className = 'sidenote-ask-bubble-status';
    status.textContent = getStatusLabel(annotation);

    const controls = this.shadowRoot.ownerDocument.createElement('div');
    controls.className = 'sidenote-ask-bubble-controls';

    if (annotation.answerState === 'failed') {
      controls.append(
        this.createIconButton('Retry side note', 'Retry', () => {
          this.handlers.onRetry?.(annotation);
        }),
      );
    }

    controls.append(
      this.createIconButton('Collapse side note', 'Collapse', () => {
        this.handlers.onCollapse(annotation);
      }),
      this.createIconButton('Delete side note', 'Delete', () => {
        this.handlers.onDelete(annotation);
      }),
    );
    header.append(status, controls);

    const body = this.shadowRoot.ownerDocument.createElement('div');
    body.className = 'sidenote-ask-bubble-body';
    body.textContent = getBodyText(annotation);

    bubble.append(header, body);
    return bubble;
  }

  private createCollapsedMarker(
    annotation: StoredAnnotation,
    source: HTMLElement,
  ): HTMLButtonElement {
    const marker = this.shadowRoot.ownerDocument.createElement('button');
    const rect = source.getBoundingClientRect();
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - 6),
      Math.max(VIEWPORT_MARGIN, this.windowRef.innerWidth - 18),
    );
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.top - 6),
      Math.max(VIEWPORT_MARGIN, this.windowRef.innerHeight - 18),
    );

    marker.type = 'button';
    marker.className = 'sidenote-ask-marker';
    marker.dataset.sidenoteMarkerId = annotation.id;
    marker.style.left = `${String(Math.round(left))}px`;
    marker.style.top = `${String(Math.round(top))}px`;
    marker.setAttribute('aria-label', 'Open side note');
    marker.addEventListener('click', () => {
      this.handlers.onExpand(annotation);
    });

    return marker;
  }

  private createIconButton(
    ariaLabel: string,
    text: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = this.shadowRoot.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', onClick);

    return button;
  }
}

function getStatusLabel(annotation: StoredAnnotation): string {
  if (annotation.answerState === 'failed') {
    return 'Failed';
  }

  if (annotation.answerState === 'complete') {
    return 'Answer';
  }

  return 'Thinking...';
}

function getBodyText(annotation: StoredAnnotation): string {
  if (annotation.answerState === 'failed') {
    return annotation.answerError ?? 'Unable to get the provider answer.';
  }

  return annotation.answerMarkdown && annotation.answerMarkdown.length > 0
    ? annotation.answerMarkdown
    : 'Waiting for provider...';
}

function getBubbleAriaLabel(annotation: StoredAnnotation): string {
  if (annotation.answerState === 'failed') {
    return 'Side note failed';
  }

  if (annotation.answerState === 'complete') {
    return 'Side note answer';
  }

  return 'Side note pending';
}

function findHighlightElement(
  documentRef: Document,
  annotationId: string,
): HTMLElement | null {
  return (
    Array.from(
      documentRef.querySelectorAll<HTMLElement>('[data-sidenote-highlight-id]'),
    ).find((element) => element.dataset.sidenoteHighlightId === annotationId) ??
    null
  );
}
