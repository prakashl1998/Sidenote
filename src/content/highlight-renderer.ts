import { resolveTextAnchor } from './anchoring';
import type { SiteAdapter } from './adapters/types';
import type { StoredAnnotation } from '../shared/models';

const HIGHLIGHT_ATTRIBUTE = 'data-sidenote-highlight-id';
const HIGHLIGHT_CLASS = 'sidenote-highlight';
const DEFAULT_HIGHLIGHT_COLOR = '#fff2a8';

export interface HighlightRenderResult {
  annotation: StoredAnnotation;
  status: 'resolved' | 'not-mounted' | 'orphaned';
  orphaned: boolean;
}

export class HighlightRenderer {
  constructor(private readonly adapter: SiteAdapter) {}

  paint(annotations: StoredAnnotation[]): HighlightRenderResult[] {
    this.clear();

    const messagesByKey = new Map(
      this.adapter
        .getAssistantMessages()
        .map((message) => [message.messageKey, message.element]),
    );

    return annotations.map((annotation) => {
      const messageElement = messagesByKey.get(annotation.messageKey);

      if (!messageElement) {
        return { annotation, status: 'not-mounted', orphaned: false };
      }

      const resolved = resolveTextAnchor(
        messageElement,
        annotation.quote,
        annotation.position,
      );

      if (!resolved) {
        return { annotation, status: 'orphaned', orphaned: true };
      }

      wrapRange(resolved.range, annotation);
      return { annotation, status: 'resolved', orphaned: false };
    });
  }

  clear(): void {
    for (const highlight of document.querySelectorAll<HTMLElement>(
      `[${HIGHLIGHT_ATTRIBUTE}]`,
    )) {
      unwrapElement(highlight);
    }
  }
}

function wrapRange(range: Range, annotation: StoredAnnotation): void {
  if (range.collapsed) {
    return;
  }

  const textSegments = collectTextSegments(range);

  for (const segment of textSegments.reverse()) {
    wrapTextSegment(segment.node, segment.start, segment.end, annotation);
  }
}

function collectTextSegments(range: Range): {
  node: Text;
  start: number;
  end: number;
}[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

  if (!root) {
    return [];
  }

  if (range.commonAncestorContainer instanceof Text) {
    return [
      {
        node: range.commonAncestorContainer,
        start: range.startOffset,
        end: range.endOffset,
      },
    ].filter((segment) => segment.end > segment.start);
  }

  const ownerDocument = range.startContainer.ownerDocument ?? document;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; start: number; end: number }[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (!(node instanceof Text) || !range.intersectsNode(node)) {
      continue;
    }

    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;

    if (end > start) {
      segments.push({ node, start, end });
    }
  }

  return segments;
}

function wrapTextSegment(
  textNode: Text,
  start: number,
  end: number,
  annotation: StoredAnnotation,
): void {
  const boundedStart = Math.max(0, Math.min(start, textNode.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, textNode.length));

  if (boundedEnd <= boundedStart) {
    return;
  }

  if (boundedEnd < textNode.length) {
    textNode.splitText(boundedEnd);
  }

  const selectedText =
    boundedStart > 0 ? textNode.splitText(boundedStart) : textNode;
  const ownerDocument = selectedText.ownerDocument;
  const wrapper = createHighlightElement(ownerDocument, annotation);

  selectedText.before(wrapper);
  wrapper.append(selectedText);
}

function createHighlightElement(
  ownerDocument: Document,
  annotation: StoredAnnotation,
): HTMLElement {
  const wrapper = ownerDocument.createElement('mark');
  wrapper.className = HIGHLIGHT_CLASS;
  wrapper.dataset.sidenoteHighlightId = annotation.id;
  wrapper.style.backgroundColor =
    annotation.color.trim() || DEFAULT_HIGHLIGHT_COLOR;
  wrapper.style.borderRadius = '3px';
  wrapper.style.padding = '0 1px';

  return wrapper;
}

function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;

  if (!parent) {
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
  parent.normalize();
}
