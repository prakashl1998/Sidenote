import type { TextPositionAnchor, TextQuoteAnchor } from '../../shared/models';

export interface AssistantMessageRef {
  messageKey: string;
  element: HTMLElement;
  text: string;
}

export interface SiteAdapter {
  readonly id: 'chatgpt';

  matches(): boolean;

  getConversationId(): string | null;

  getAssistantMessages(): AssistantMessageRef[];

  resolveSelection(range: Range): {
    message: AssistantMessageRef;
    quote: TextQuoteAnchor;
    position: TextPositionAnchor;
  } | null;

  getContextForMessage(messageKey: string, budget: number): string;

  healthCheck(): { ok: boolean; failures: string[] };
}
