declare module 'dom-anchor-text-position' {
  export interface TextPositionSelector {
    start: number;
    end: number;
  }

  export function fromRange(root: Node, range: Range): TextPositionSelector;
  export function toRange(root: Node, selector: TextPositionSelector): Range;
}

declare module 'dom-anchor-text-quote' {
  import type { TextPositionSelector } from 'dom-anchor-text-position';

  export interface TextQuoteSelector {
    exact: string;
    prefix: string;
    suffix: string;
  }

  export function fromRange(root: Node, range: Range): TextQuoteSelector;
  export function fromTextPosition(
    root: Node,
    selector: TextPositionSelector,
  ): TextQuoteSelector;
  export function toRange(
    root: Node,
    selector: TextQuoteSelector,
    options?: { hint?: number },
  ): Range | null;
  export function toTextPosition(
    root: Node,
    selector: TextQuoteSelector,
    options?: { hint?: number },
  ): TextPositionSelector | null;
}
