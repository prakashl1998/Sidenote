import type { ClarificationProviderId } from '../models';

export interface ClarifyRequest {
  highlightedText: string;
  question: string;
  context: string;
  conversationId: string;
  messageKey: string;
  source: {
    site: 'chatgpt';
    url: string;
    title?: string;
  };
  model?: string;
}

export interface ClarifyResponse {
  answerMarkdown: string;
  provider: {
    id: ClarificationProviderId;
    model?: string;
    endpointLabel?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ClarificationProvider {
  readonly id: ClarificationProviderId;
  explain(input: ClarifyRequest, signal: AbortSignal): Promise<ClarifyResponse>;
  healthCheck(
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; failures: string[] }>;
}
