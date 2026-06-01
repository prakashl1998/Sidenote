import { createTextAnchor } from '../anchoring';
import type { TextPositionAnchor, TextQuoteAnchor } from '../../shared/models';
import type { AssistantMessageRef, SiteAdapter } from './types';

const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';
const ROLE_MESSAGE_SELECTOR = '[data-message-author-role]';
const MESSAGE_ID_SELECTOR = '[data-message-id]';

export class ChatGptAdapter implements SiteAdapter {
  readonly id = 'chatgpt' as const;

  constructor(
    private readonly locationRef: Location = location,
    private readonly documentRef: Document = document,
  ) {}

  matches(): boolean {
    return this.locationRef.hostname === 'chatgpt.com';
  }

  getConversationId(): string | null {
    const match = /^\/c\/([^/?#]+)/u.exec(this.locationRef.pathname);
    return match?.[1] ?? null;
  }

  getAssistantMessages(): AssistantMessageRef[] {
    const directMatches = Array.from(
      this.documentRef.querySelectorAll<HTMLElement>(
        ASSISTANT_MESSAGE_SELECTOR,
      ),
    );
    const elements =
      directMatches.length > 0 ? directMatches : this.getMessageIdFallbacks();

    return elements.map((element, index) =>
      this.toAssistantMessageRef(element, index),
    );
  }

  resolveSelection(range: Range): {
    message: AssistantMessageRef;
    quote: TextQuoteAnchor;
    position: TextPositionAnchor;
  } | null {
    const exact = range.toString();

    if (exact.trim().length === 0) {
      return null;
    }

    const message = this.getAssistantMessages().find((candidate) =>
      candidate.element.contains(range.commonAncestorContainer),
    );

    if (!message) {
      return null;
    }

    try {
      const anchor = createTextAnchor(message.element, range);

      return {
        message,
        quote: anchor.quote,
        position: anchor.position,
      };
    } catch {
      return null;
    }
  }

  getContextForMessage(messageKey: string, budget: number): string {
    const turns = this.getConversationTurns();
    const sourceTurnIndex = turns.findIndex(
      (turn) =>
        turn.role === 'assistant' &&
        this.toAssistantMessageRef(turn.element, turn.assistantIndex)
          .messageKey === messageKey,
    );

    if (sourceTurnIndex < 0) {
      return trimOldestFirst(
        this.getAssistantMessages().find(
          (candidate) => candidate.messageKey === messageKey,
        )?.text ?? '',
        budget,
      );
    }

    return trimOldestFirst(
      turns
        .slice(0, sourceTurnIndex + 1)
        .map(
          (turn) =>
            `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`,
        )
        .join('\n\n'),
      budget,
    );
  }

  healthCheck(): { ok: boolean; failures: string[] } {
    const failures: string[] = [];

    if (!this.matches()) {
      failures.push('Not running on chatgpt.com.');
    }

    if (this.getAssistantMessages().length === 0) {
      failures.push('No assistant messages found.');
    }

    return { ok: failures.length === 0, failures };
  }

  private getMessageIdFallbacks(): HTMLElement[] {
    return Array.from(
      this.documentRef.querySelectorAll<HTMLElement>(MESSAGE_ID_SELECTOR),
    ).filter(isAssistantMessageElement);
  }

  private toAssistantMessageRef(
    element: HTMLElement,
    index: number,
  ): AssistantMessageRef {
    const text = normalizeText(element.textContent);

    return {
      element,
      messageKey:
        getElementMessageId(element) ??
        hashMessageKey(this.getConversationId(), index, text),
      text,
    };
  }

  private getConversationTurns(): {
    role: 'assistant' | 'user';
    element: HTMLElement;
    text: string;
    assistantIndex: number;
  }[] {
    let assistantIndex = -1;

    return Array.from(
      this.documentRef.querySelectorAll<HTMLElement>(ROLE_MESSAGE_SELECTOR),
    )
      .map((element) => {
        const role = element.getAttribute('data-message-author-role');

        if (role !== 'assistant' && role !== 'user') {
          return null;
        }

        if (role === 'assistant') {
          assistantIndex += 1;
        }

        return {
          role,
          element,
          text: normalizeText(element.textContent),
          assistantIndex,
        };
      })
      .filter(
        (
          turn,
        ): turn is {
          role: 'assistant' | 'user';
          element: HTMLElement;
          text: string;
          assistantIndex: number;
        } => turn !== null && turn.text.length > 0,
      );
  }
}

function getElementMessageId(element: HTMLElement): string | null {
  return (
    element.dataset.messageId ??
    element.querySelector<HTMLElement>(MESSAGE_ID_SELECTOR)?.dataset
      .messageId ??
    null
  );
}

export function createChatGptAdapter(
  locationRef: Location = location,
  documentRef: Document = document,
): ChatGptAdapter {
  return new ChatGptAdapter(locationRef, documentRef);
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function trimOldestFirst(value: string, budget: number): string {
  if (value.length <= budget) {
    return value;
  }

  return value.slice(value.length - budget).trimStart();
}

function isAssistantMessageElement(element: HTMLElement): boolean {
  const authorRole =
    element.getAttribute('data-message-author-role') ??
    element
      .closest<HTMLElement>('[data-message-author-role]')
      ?.getAttribute('data-message-author-role');

  if (authorRole) {
    return authorRole === 'assistant';
  }

  const signal = [
    element.getAttribute('aria-label'),
    element.closest<HTMLElement>('[aria-label]')?.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();

  return (
    /\b(assistant|chatgpt)\b/u.test(signal) && !/\b(user|you)\b/u.test(signal)
  );
}

function hashMessageKey(
  conversationId: string | null,
  index: number,
  text: string,
): string {
  const source = `${conversationId ?? 'unknown'}:${String(index)}:${text.slice(
    0,
    64,
  )}`;
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return `assistant-${String(index)}-${hash.toString(36)}`;
}
