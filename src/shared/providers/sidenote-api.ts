import {
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_SIDENOTE_API_BASE_URL,
} from './constants';
import type {
  ClarificationProvider,
  ClarifyRequest,
  ClarifyResponse,
} from './types';

type FetchLike = typeof fetch;

export class SidenoteApiProvider implements ClarificationProvider {
  readonly id = 'sidenote-api' as const;

  constructor(
    private readonly baseUrl = DEFAULT_SIDENOTE_API_BASE_URL,
    private readonly fetchRef: FetchLike = getDefaultFetch(),
  ) {}

  async explain(
    input: ClarifyRequest,
    signal: AbortSignal,
  ): Promise<ClarifyResponse> {
    try {
      const response = await this.fetchRef.call(
        globalThis,
        this.getClarifyUrl(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...input,
            model: input.model ?? DEFAULT_CLARIFY_MODEL,
          }),
          signal,
        },
      );

      if (!response.ok) {
        throw new Error(getStatusErrorLabel(response.status));
      }

      const payload = await readJsonResponse(response);

      if (!isClarifyResponse(payload)) {
        throw new Error('Provider returned an invalid clarification response.');
      }

      return payload;
    } catch (error) {
      throw toSafeProviderError(error);
    }
  }

  async healthCheck(
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; failures: string[] }> {
    try {
      const response = await this.fetchRef.call(
        globalThis,
        this.getHealthUrl(),
        {
          signal,
        },
      );

      if (response.ok) {
        return { ok: true, failures: [] };
      }

      return { ok: false, failures: [getStatusErrorLabel(response.status)] };
    } catch (error) {
      return { ok: false, failures: [toSafeErrorMessage(error)] };
    }
  }

  private getClarifyUrl(): string {
    return `${this.baseUrl.replace(/\/+$/u, '')}/api/clarify`;
  }

  private getHealthUrl(): string {
    return `${this.baseUrl.replace(/\/+$/u, '')}/api/health`;
  }
}

function getDefaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('Provider returned an invalid clarification response.');
  }
}

function isClarifyResponse(value: unknown): value is ClarifyResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ClarifyResponse>;
  const provider = candidate.provider;

  return (
    typeof candidate.answerMarkdown === 'string' &&
    candidate.answerMarkdown.trim().length > 0 &&
    !!provider &&
    typeof provider === 'object' &&
    provider.id === 'sidenote-api'
  );
}

function getStatusErrorLabel(status: number): string {
  if (status === 400) {
    return 'Provider rejected the clarification request.';
  }

  if (status === 401 || status === 403) {
    return 'Provider authorization failed.';
  }

  if (status === 429) {
    return 'Provider rate limit reached.';
  }

  if (status >= 500) {
    return 'Provider is temporarily unavailable.';
  }

  return 'Provider request failed.';
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Provider request was cancelled.';
  }

  if (error instanceof Error && isKnownSafeErrorMessage(error.message)) {
    return error.message;
  }

  return 'Provider network request failed.';
}

function toSafeProviderError(error: unknown): Error {
  return new Error(toSafeErrorMessage(error), {
    cause:
      error instanceof Error && isKnownSafeErrorMessage(error.message)
        ? error
        : new Error('Provider failure details hidden.'),
  });
}

function isKnownSafeErrorMessage(message: string): boolean {
  return [
    'Provider rejected the clarification request.',
    'Provider authorization failed.',
    'Provider rate limit reached.',
    'Provider is temporarily unavailable.',
    'Provider request failed.',
    'Provider returned an invalid clarification response.',
  ].includes(message);
}
