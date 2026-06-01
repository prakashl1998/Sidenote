import type { SiteAdapter } from './adapters/types';

export interface SelectionControllerOptions {
  adapter: SiteAdapter;
  documentRef?: Document;
  windowRef?: Window;
  isDismissalClickIgnored?: (event: PointerEvent) => boolean;
  onSelection: (selection: {
    range: Range;
    rect: DOMRect;
    messageKey: string;
  }) => void;
  onDismiss: () => void;
}

export class SelectionController {
  private readonly documentRef: Document;
  private readonly windowRef: Window;
  private readonly isDismissalClickIgnored: (event: PointerEvent) => boolean;
  private selectionTimer: number | null = null;

  constructor(private readonly options: SelectionControllerOptions) {
    this.documentRef = options.documentRef ?? document;
    this.windowRef = options.windowRef ?? window;
    this.isDismissalClickIgnored =
      options.isDismissalClickIgnored ?? (() => false);
  }

  connect(): void {
    this.documentRef.addEventListener(
      'selectionchange',
      this.scheduleSelectionEvaluation,
    );
    this.documentRef.addEventListener('mouseup', this.evaluateCurrentSelection);
    this.documentRef.addEventListener('keyup', this.evaluateCurrentSelection);
    this.documentRef.addEventListener('pointerdown', this.handlePointerDown);
    this.documentRef.addEventListener('keydown', this.handleKeyDown);
    this.windowRef.addEventListener('scroll', this.dismiss, true);
  }

  disconnect(): void {
    if (this.selectionTimer !== null) {
      this.windowRef.clearTimeout(this.selectionTimer);
      this.selectionTimer = null;
    }

    this.documentRef.removeEventListener(
      'selectionchange',
      this.scheduleSelectionEvaluation,
    );
    this.documentRef.removeEventListener(
      'mouseup',
      this.evaluateCurrentSelection,
    );
    this.documentRef.removeEventListener(
      'keyup',
      this.evaluateCurrentSelection,
    );
    this.documentRef.removeEventListener('pointerdown', this.handlePointerDown);
    this.documentRef.removeEventListener('keydown', this.handleKeyDown);
    this.windowRef.removeEventListener('scroll', this.dismiss, true);
  }

  evaluateCurrentSelection = (): void => {
    const selection = this.documentRef.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.dismiss();
      return;
    }

    const range = selection.getRangeAt(0);
    const resolved = this.options.adapter.resolveSelection(range);

    if (!resolved) {
      this.dismiss();
      return;
    }

    const rect = getSelectionRect(range);

    if (!rect || rect.width === 0 || rect.height === 0) {
      this.dismiss();
      return;
    }

    this.options.onSelection({
      range: range.cloneRange(),
      rect,
      messageKey: resolved.message.messageKey,
    });
  };

  dismiss = (): void => {
    this.options.onDismiss();
  };

  private scheduleSelectionEvaluation = (): void => {
    if (this.selectionTimer !== null) {
      this.windowRef.clearTimeout(this.selectionTimer);
    }

    this.selectionTimer = this.windowRef.setTimeout(() => {
      this.selectionTimer = null;
      this.evaluateCurrentSelection();
    }, 0);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.isDismissalClickIgnored(event)) {
      this.dismiss();
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.dismiss();
    }
  };
}

function getSelectionRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();

  if (rect.width > 0 && rect.height > 0) {
    return rect;
  }

  const rects = range.getClientRects();

  return rects.length > 0 ? rects.item(0) : null;
}
