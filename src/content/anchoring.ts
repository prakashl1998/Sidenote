import * as textPosition from 'dom-anchor-text-position';
import * as textQuote from 'dom-anchor-text-quote';

import type { TextPositionAnchor, TextQuoteAnchor } from '../shared/models';

export interface TextAnchor {
  quote: TextQuoteAnchor;
  position: TextPositionAnchor;
}

export interface ResolvedTextAnchor {
  range: Range;
  position: TextPositionAnchor;
}

export function createTextAnchor(root: HTMLElement, range: Range): TextAnchor {
  const position: TextPositionAnchor = textPosition.fromRange(root, range);
  const quote: TextQuoteAnchor = textQuote.fromTextPosition(root, position);

  return { quote, position };
}

export function resolveTextAnchor(
  root: HTMLElement,
  quote: TextQuoteAnchor,
  position: TextPositionAnchor,
): ResolvedTextAnchor | null {
  const quotePosition = textQuote.toTextPosition(root, quote, {
    hint: position.start,
  });

  if (quotePosition && exactTextMatches(root, quote, quotePosition)) {
    return {
      range: textPosition.toRange(root, quotePosition),
      position: quotePosition,
    };
  }

  const exactPosition = resolveExactTextPosition(root, quote, position);

  if (exactPosition) {
    return {
      range: textPosition.toRange(root, exactPosition),
      position: exactPosition,
    };
  }

  const fallbackRange = resolvePositionFallback(root, quote, position);

  if (!fallbackRange) {
    return null;
  }

  return {
    range: fallbackRange,
    position,
  };
}

function exactTextMatches(
  root: HTMLElement,
  quote: TextQuoteAnchor,
  position: TextPositionAnchor,
): boolean {
  return root.textContent.slice(position.start, position.end) === quote.exact;
}

function resolveExactTextPosition(
  root: HTMLElement,
  quote: TextQuoteAnchor,
  hint: TextPositionAnchor,
): TextPositionAnchor | null {
  if (quote.exact.length === 0) {
    return null;
  }

  const text = root.textContent;
  const positions: TextPositionAnchor[] = [];
  let searchFrom = 0;

  while (searchFrom <= text.length) {
    const start = text.indexOf(quote.exact, searchFrom);

    if (start < 0) {
      break;
    }

    positions.push({ start, end: start + quote.exact.length });
    searchFrom = start + Math.max(quote.exact.length, 1);
  }

  if (positions.length === 0) {
    return null;
  }

  return (
    positions
      .map((candidate) => ({
        candidate,
        score: getContextScore(text, quote, candidate, hint),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
  );
}

function getContextScore(
  text: string,
  quote: TextQuoteAnchor,
  candidate: TextPositionAnchor,
  hint: TextPositionAnchor,
): number {
  const prefixStart = Math.max(0, candidate.start - quote.prefix.length);
  const suffixEnd = candidate.end + quote.suffix.length;
  let score = 0;

  if (
    quote.prefix &&
    text.slice(prefixStart, candidate.start) === quote.prefix
  ) {
    score += 1000;
  }

  if (quote.suffix && text.slice(candidate.end, suffixEnd) === quote.suffix) {
    score += 1000;
  }

  return score - Math.abs(candidate.start - hint.start);
}

function resolvePositionFallback(
  root: HTMLElement,
  quote: TextQuoteAnchor,
  position: TextPositionAnchor,
): Range | null {
  const text = root.textContent;
  const fallbackExact = text.slice(position.start, position.end);

  if (fallbackExact !== quote.exact) {
    return null;
  }

  try {
    return textPosition.toRange(root, position);
  } catch {
    return null;
  }
}
