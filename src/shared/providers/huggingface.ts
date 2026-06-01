import {
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_HUGGING_FACE_PRESET_ID,
  DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
  normalizeHuggingFaceRouterBaseUrl,
} from './constants';
import type {
  ClarificationProvider,
  ClarifyRequest,
  ClarifyResponse,
} from './types';

type FetchLike = typeof fetch;

export interface HuggingFaceProviderOptions {
  baseUrl?: string;
  model?: string;
  presetId?: string;
  getToken: (presetId: string) => Promise<string | null>;
  fetchRef?: FetchLike;
  timeoutMs?: number;
}

export class HuggingFaceProvider implements ClarificationProvider {
  readonly id = 'huggingface' as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly presetId: string;
  private readonly fetchRef: FetchLike;
  private readonly timeoutMs: number;

  constructor({
    baseUrl = DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
    model = DEFAULT_CLARIFY_MODEL,
    presetId = DEFAULT_HUGGING_FACE_PRESET_ID,
    getToken,
    fetchRef = getDefaultFetch(),
    timeoutMs = 30_000,
  }: HuggingFaceProviderOptions) {
    this.baseUrl = normalizeHuggingFaceRouterBaseUrl(baseUrl);
    this.model = model;
    this.presetId = presetId;
    this.getToken = getToken;
    this.fetchRef = fetchRef;
    this.timeoutMs = timeoutMs;
  }

  private readonly getToken: (presetId: string) => Promise<string | null>;

  async explain(
    input: ClarifyRequest,
    signal: AbortSignal,
  ): Promise<ClarifyResponse> {
    const token = await this.getToken(this.presetId);

    if (!token) {
      throw new Error('Hugging Face token required.');
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort('timeout');
    }, this.timeoutMs);
    const abortExternal = (): void => {
      timeoutController.abort('abort');
    };

    try {
      if (signal.aborted) {
        throw new Error('Provider request was cancelled.');
      }

      signal.addEventListener('abort', abortExternal, { once: true });

      const response = await this.fetchRef.call(
        globalThis,
        this.getChatCompletionsUrl(),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(toHuggingFaceRequest(input, this.model)),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: timeoutController.signal,
        },
      );

      if (!response.ok) {
        throw new Error(getStatusErrorLabel(response.status));
      }

      return parseHuggingFaceResponse(
        await readJsonResponse(response),
        this.model,
      );
    } catch (error) {
      throw toSafeProviderError(error, timeoutController.signal);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortExternal);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; failures: string[] }> {
    const token = await this.getToken(this.presetId);

    return token
      ? { ok: true, failures: [] }
      : { ok: false, failures: ['Hugging Face token required.'] };
  }

  private getChatCompletionsUrl(): string {
    return `${this.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
  }
}

function getDefaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}

function toHuggingFaceRequest(
  input: ClarifyRequest,
  defaultModel: string,
): {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  max_tokens: number;
  temperature: number;
  stream: false;
} {
  return {
    model: defaultModel,
    messages: [
      {
        role: 'system',
        content:
          "You answer the user's question about highlighted text from an assistant response. Do not use hidden reasoning or thinking mode. Answer the Question field directly and concretely, using the highlighted text and context only as grounding. Do not give a generic explanation unless the question asks for one. Return Markdown only.",
      },
      {
        role: 'user',
        content: [
          '/no_think',
          `Highlighted text:\n${input.highlightedText}`,
          `Context:\n${input.context}`,
          `Question:\n${input.question}`,
        ].join('\n\n'),
      },
    ],
    max_tokens: 512,
    temperature: 0.2,
    stream: false,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('Provider returned malformed JSON.');
  }
}

function parseHuggingFaceResponse(
  payload: unknown,
  model: string,
): ClarifyResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Provider returned malformed JSON.');
  }

  const candidate = payload as {
    choices?: {
      text?: unknown;
      finish_reason?: unknown;
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
      };
    }[];
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
    generated_text?: unknown;
  };
  const firstChoice = candidate.choices?.[0];
  const content =
    extractAnswerContent(firstChoice?.message?.content) ??
    extractAnswerContent(firstChoice?.text) ??
    extractAnswerContent(candidate.generated_text);

  if (!content) {
    if (hasText(firstChoice?.message?.reasoning_content)) {
      throw new Error('Provider returned reasoning without answer content.');
    }

    if (firstChoice?.finish_reason === 'length') {
      throw new Error('Provider response ended before an answer.');
    }

    throw new Error('Provider returned no answer content.');
  }

  return {
    answerMarkdown: content,
    provider: {
      id: 'huggingface',
      model,
      endpointLabel: 'Hugging Face',
    },
    usage: {
      inputTokens: numberOrUndefined(candidate.usage?.prompt_tokens),
      outputTokens: numberOrUndefined(candidate.usage?.completion_tokens),
      totalTokens: numberOrUndefined(candidate.usage?.total_tokens),
    },
  };
}

function extractAnswerContent(value: unknown): string | null {
  const rawContent = normalizeContent(value);

  if (!rawContent) {
    return null;
  }

  const withoutThinking = rawContent
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .trim();

  return withoutThinking.length > 0 ? withoutThinking : null;
}

function normalizeContent(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (!part || typeof part !== 'object') {
        return '';
      }

      const candidate = part as Record<string, unknown>;
      const text = candidate.text ?? candidate.content;

      return typeof text === 'string' ? text : '';
    })
    .join('');
  const trimmed = parts.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toSafeProviderError(error: unknown, signal: AbortSignal): Error {
  return new Error(toSafeErrorMessage(error, signal), {
    cause:
      error instanceof Error && isKnownSafeErrorMessage(error.message)
        ? error
        : new Error('Provider failure details hidden.'),
  });
}

function getStatusErrorLabel(status: number): string {
  if (status === 401 || status === 403) {
    return 'Hugging Face authorization failed.';
  }

  if (status === 429) {
    return 'Hugging Face rate limit reached.';
  }

  if (status >= 500) {
    return 'Hugging Face is temporarily unavailable.';
  }

  return 'Hugging Face request failed.';
}

function toSafeErrorMessage(error: unknown, signal: AbortSignal): string {
  if (
    error instanceof Error &&
    error.message === 'Provider request timed out.'
  ) {
    return error.message;
  }

  if (signal.aborted && signal.reason === 'timeout') {
    return 'Provider request timed out.';
  }

  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (signal.aborted && signal.reason === 'abort')
  ) {
    return 'Provider request was cancelled.';
  }

  if (error instanceof Error && isKnownSafeErrorMessage(error.message)) {
    return error.message;
  }

  return 'Provider network request failed.';
}

function isKnownSafeErrorMessage(message: string): boolean {
  return [
    'Hugging Face token required.',
    'Hugging Face authorization failed.',
    'Hugging Face rate limit reached.',
    'Hugging Face is temporarily unavailable.',
    'Provider returned malformed JSON.',
    'Provider returned no answer content.',
    'Provider returned reasoning without answer content.',
    'Provider response ended before an answer.',
    'Hugging Face request failed.',
    'Provider request was cancelled.',
  ].includes(message);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
