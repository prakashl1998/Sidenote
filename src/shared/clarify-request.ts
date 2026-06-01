import type { ClarifyRequest } from './providers/types';
import {
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_EXPLAIN_QUESTION,
} from './providers/constants';

export {
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_EXPLAIN_QUESTION,
} from './providers/constants';

export const DEFAULT_CONTEXT_BUDGET = 1500;

export interface BuildClarifyRequestOptions {
  exact: string;
  context: string;
  question?: string;
  conversationId: string;
  messageKey: string;
  source: ClarifyRequest['source'];
  model?: string;
  contextBudget?: number;
}

export function buildClarifyRequest({
  exact,
  context,
  question,
  conversationId,
  messageKey,
  source,
  model = DEFAULT_CLARIFY_MODEL,
  contextBudget = DEFAULT_CONTEXT_BUDGET,
}: BuildClarifyRequestOptions): ClarifyRequest {
  const trimmedQuestion = question?.trim();

  return {
    highlightedText: exact,
    question:
      trimmedQuestion && trimmedQuestion.length > 0
        ? trimmedQuestion
        : DEFAULT_EXPLAIN_QUESTION,
    context: trimContextOldestFirst(context, contextBudget),
    conversationId,
    messageKey,
    source,
    model,
  };
}

export function trimContextOldestFirst(
  context: string,
  budget: number,
): string {
  const normalized = context.replace(/\s+\n/gu, '\n').trim();

  if (budget <= 0) {
    return '';
  }

  if (normalized.length <= budget) {
    return normalized;
  }

  return normalized.slice(normalized.length - budget).trimStart();
}
