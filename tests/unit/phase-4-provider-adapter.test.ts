import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatGptAdapter } from '../../src/content/adapters/chatgpt-adapter';
import {
  buildClarifyRequest,
  DEFAULT_CLARIFY_MODEL,
  DEFAULT_EXPLAIN_QUESTION,
} from '../../src/shared/clarify-request';
import { handleRuntimeMessage } from '../../src/background/provider-routing';
import { CLARIFY_MESSAGE_TYPE } from '../../src/shared/messaging';
import {
  DEFAULT_HUGGING_FACE_PRESET_ID,
  DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
} from '../../src/shared/providers/constants';
import { HuggingFaceProvider } from '../../src/shared/providers/huggingface';
import { SidenoteApiProvider } from '../../src/shared/providers/sidenote-api';
import type {
  ClarificationProvider,
  ClarifyRequest,
} from '../../src/shared/providers/types';
import {
  getProviderSettings,
  getProviderSecretKey,
  setProviderSecret,
  type ChromeStorageAreaLike,
  updateProviderSettings,
} from '../../src/shared/storage';

const CHATGPT_LOCATION = {
  hostname: 'chatgpt.com',
  pathname: '/c/phase-4-unit',
  href: 'https://chatgpt.com/c/phase-4-unit',
} as Location;

describe('Phase 4 provider-backed clarify logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('builds a provider request with the default question, selected source ids, model, and trimmed context', () => {
    const request = buildClarifyRequest({
      exact: 'TTL',
      context: `older ${'x'.repeat(1600)} immediate TTL context`,
      conversationId: 'phase-4-unit',
      messageKey: 'assistant-2',
      source: {
        site: 'chatgpt',
        url: 'https://chatgpt.com/c/phase-4-unit',
        title: 'Cache notes',
      },
      contextBudget: 80,
    });

    expect(request).toMatchObject({
      highlightedText: 'TTL',
      question: DEFAULT_EXPLAIN_QUESTION,
      conversationId: 'phase-4-unit',
      messageKey: 'assistant-2',
      model: DEFAULT_CLARIFY_MODEL,
      source: {
        site: 'chatgpt',
        url: 'https://chatgpt.com/c/phase-4-unit',
        title: 'Cache notes',
      },
    });
    expect(request.context).toContain('immediate TTL context');
    expect(request.context.length).toBeLessThanOrEqual(80);
  });

  it('collects nearby turns up to the source assistant message and does not inspect the composer for health', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="user" data-message-id="user-1">
          <p>Older user turn that should be trimmed first.</p>
        </article>
        <article data-message-author-role="assistant" data-message-id="assistant-1">
          <p>Older assistant turn that should be trimmed first.</p>
        </article>
        <article data-message-author-role="user" data-message-id="user-2">
          <p>What does volatile-lru do?</p>
        </article>
        <article data-message-author-role="assistant" data-message-id="assistant-2">
          <p>volatile-lru only evicts keys with TTL metadata.</p>
        </article>
        <article data-message-author-role="assistant" data-message-id="assistant-3">
          <p>Future assistant text must not be included.</p>
        </article>
      </main>
    `;

    const adapter = new ChatGptAdapter(CHATGPT_LOCATION, document);
    const context = adapter.getContextForMessage('assistant-2', 95);

    expect(context).toContain('User: What does volatile-lru do?');
    expect(context).toContain(
      'Assistant: volatile-lru only evicts keys with TTL metadata.',
    );
    expect(context).not.toContain('Future assistant text');
    expect(context).not.toContain('Older user turn');
    expect(adapter.healthCheck()).toEqual({ ok: true, failures: [] });
  });

  it('uses nested ChatGPT message ids so highlights survive wrapper re-renders', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div data-message-id="nested-assistant-id">
            <p>Assistant text with nested message id.</p>
          </div>
        </article>
      </main>
    `;

    const adapter = new ChatGptAdapter(CHATGPT_LOCATION, document);

    expect(adapter.getAssistantMessages()[0]?.messageKey).toBe(
      'nested-assistant-id',
    );
  });

  it('posts to the Sidenote API clarify endpoint and parses provider metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            answerMarkdown: 'TTL means time to live.',
            provider: {
              id: 'sidenote-api',
              model: 'Qwen/Qwen3-8B',
              endpointLabel: 'Sidenote API',
            },
            usage: {
              inputTokens: 12,
              outputTokens: 6,
              totalTokens: 18,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    const provider = new SidenoteApiProvider(
      'https://mock.sidenote.test/',
      fetchMock,
    );

    const response = await provider.explain(
      makeClarifyRequest({ question: 'Why is TTL the deciding bit?' }),
      new AbortController().signal,
    );
    const firstCall = fetchMock.mock.calls[0];

    const requestInit = firstCall[1];

    if (!requestInit) {
      throw new Error('Expected provider fetch options.');
    }

    const requestBody = requestInit.body;

    if (typeof requestBody !== 'string') {
      throw new Error('Expected JSON request body.');
    }

    expect(firstCall[0]).toBe('https://mock.sidenote.test/api/clarify');
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(requestBody)).toMatchObject({
      highlightedText: 'TTL',
    });
    expect(response).toMatchObject({
      answerMarkdown: 'TTL means time to live.',
      provider: {
        id: 'sidenote-api',
        model: 'Qwen/Qwen3-8B',
        endpointLabel: 'Sidenote API',
      },
      usage: {
        totalTokens: 18,
      },
    });
  });

  it('calls injected worker fetch with the global receiver instead of the provider instance', async () => {
    const workerFetch: typeof fetch = function (
      this: unknown,
      input: RequestInfo | URL,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url.endsWith('/api/health')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            answerMarkdown: 'Bound fetch works.',
            provider: {
              id: 'sidenote-api',
              model: 'Qwen/Qwen3-8B',
              endpointLabel: 'Sidenote API',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    };
    const provider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      workerFetch,
    );

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).resolves.toMatchObject({
      answerMarkdown: 'Bound fetch works.',
    });
    await expect(
      provider.healthCheck(new AbortController().signal),
    ).resolves.toEqual({
      ok: true,
      failures: [],
    });
  });

  it('returns safe provider errors for rejected API responses and malformed JSON', async () => {
    const rejectedProvider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('nope', { status: 429 })),
      ),
    );

    await expect(
      rejectedProvider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider rate limit reached.');

    const malformedProvider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response('{not json', {
            status: 200,
          }),
        ),
      ),
    );

    await expect(
      malformedProvider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider returned an invalid clarification response.');

    const missingAnswerProvider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              provider: {
                id: 'sidenote-api',
              },
            }),
            {
              status: 200,
            },
          ),
        ),
      ),
    );

    await expect(
      missingAnswerProvider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider returned an invalid clarification response.');
  });

  it('maps Sidenote abort and network failures to safe errors', async () => {
    const abortProvider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.reject(new DOMException('Aborted', 'AbortError')),
      ),
    );

    await expect(
      abortProvider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow('Provider request was cancelled.');

    const networkProvider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.reject(new Error('network failed with private details')),
      ),
    );

    await expect(
      networkProvider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider network request failed.');
  });

  it.each([
    [401, 'Provider authorization failed.'],
    [403, 'Provider authorization failed.'],
    [429, 'Provider rate limit reached.'],
    [500, 'Provider is temporarily unavailable.'],
  ])('maps Sidenote HTTP %s to a safe error', async (status, message) => {
    const provider = new SidenoteApiProvider(
      'https://mock.sidenote.test',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('hidden response body', { status })),
      ),
    );

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow(message);
  });

  it('parses Hugging Face OpenAI-compatible answers and sends the saved token only in Authorization', async () => {
    const token = 'test-secret-should-not-leak';
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'TTL means time to live.',
                },
              },
            ],
            usage: {
              prompt_tokens: 21,
              completion_tokens: 7,
              total_tokens: 28,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new HuggingFaceProvider({
      baseUrl: DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
      getToken: vi.fn(() => Promise.resolve(token)),
      fetchRef: fetchMock,
    });
    const response = await provider.explain(
      makeClarifyRequest({ question: 'Why is TTL the deciding bit?' }),
      new AbortController().signal,
    );
    const fetchOptions = fetchMock.mock.calls[0][1];

    if (!fetchOptions || typeof fetchOptions.body !== 'string') {
      throw new Error('Expected Hugging Face request options.');
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://router.huggingface.co/v1/chat/completions',
    );
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers).toEqual({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    expect(fetchOptions.credentials).toBe('omit');
    expect(fetchOptions.referrerPolicy).toBe('no-referrer');
    const body = JSON.parse(fetchOptions.body) as {
      max_tokens: number;
      stream: boolean;
      messages: { content: string }[];
    };

    expect(JSON.stringify(body)).not.toContain(token);
    expect(body.max_tokens).toBe(512);
    expect(body.stream).toBe(false);
    expect(body.messages[0]?.content).toContain(
      'Answer the Question field directly',
    );
    expect(body.messages[0]?.content).toContain(
      'Do not give a generic explanation unless the question asks for one.',
    );
    expect(body.messages[1]?.content).toContain('/no_think');
    expect(body.messages[1]?.content).toContain(
      'Question:\nWhy is TTL the deciding bit?',
    );
    expect(response).toEqual({
      answerMarkdown: 'TTL means time to live.',
      provider: {
        id: 'huggingface',
        model: 'Qwen/Qwen3-8B',
        endpointLabel: 'Hugging Face',
      },
      usage: {
        inputTokens: 21,
        outputTokens: 7,
        totalTokens: 28,
      },
    });
  });

  it('does not call Hugging Face without a stored token and returns a clear safe error', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve(null)),
      fetchRef: fetchMock,
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow('Hugging Face token required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults fresh installs to direct Hugging Face BYOK and fails safely until a token is stored', async () => {
    const storageArea = createMemoryStorage();
    const fetchMock = vi.fn<typeof fetch>();

    vi.stubGlobal('chrome', { runtime: {} });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProviderSettings(storageArea)).resolves.toMatchObject({
      activeProviderId: 'huggingface',
      huggingFaceRouterBaseUrl: DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
      huggingFacePresetId: DEFAULT_HUGGING_FACE_PRESET_ID,
      defaultModel: DEFAULT_CLARIFY_MODEL,
      byokPresets: [
        {
          id: DEFAULT_HUGGING_FACE_PRESET_ID,
          providerId: 'huggingface',
          apiKeyStorageKey: getProviderSecretKey(
            DEFAULT_HUGGING_FACE_PRESET_ID,
          ),
        },
      ],
    });
    await expect(
      handleRuntimeMessage(
        {
          type: CLARIFY_MESSAGE_TYPE,
          requestId: 'clarify-default-hf-missing-token',
          request: makeClarifyRequest(),
        },
        undefined,
        new Map(),
        storageArea,
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'Hugging Face token required.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'Hugging Face authorization failed.'],
    [403, 'Hugging Face authorization failed.'],
    [429, 'Hugging Face rate limit reached.'],
    [500, 'Hugging Face is temporarily unavailable.'],
  ])('maps Hugging Face HTTP %s to a safe error', async (status, message) => {
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response('do not expose provider body', { status }),
        ),
      ),
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow(message);
  });

  it.each([
    ['{not json', 'Provider returned malformed JSON.'],
    [JSON.stringify({ choices: [] }), 'Provider returned no answer content.'],
    [
      JSON.stringify({ choices: [{ message: {} }] }),
      'Provider returned no answer content.',
    ],
  ])('maps Hugging Face bad payloads to safe errors', async (body, message) => {
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(body, { status: 200 })),
      ),
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow(message);
  });

  it('parses Hugging Face text-part content without exposing thinking blocks', async () => {
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: [
                      {
                        type: 'text',
                        text: '<think>private reasoning</think>TTL means time to live.',
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).resolves.toMatchObject({
      answerMarkdown: 'TTL means time to live.',
    });
  });

  it.each([
    [{ choices: [{ text: 'Text fallback answer.' }] }, 'Text fallback answer.'],
    [{ generated_text: 'Generated text answer.' }, 'Generated text answer.'],
  ])(
    'parses Hugging Face fallback text response shapes',
    async (payload, expected) => {
      const provider = new HuggingFaceProvider({
        getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
        fetchRef: vi.fn<typeof fetch>(() =>
          Promise.resolve(
            new Response(JSON.stringify(payload), { status: 200 }),
          ),
        ),
      });

      await expect(
        provider.explain(makeClarifyRequest(), new AbortController().signal),
      ).resolves.toMatchObject({
        answerMarkdown: expected,
      });
    },
  );

  it('does not expose Hugging Face reasoning-only responses as answers', async () => {
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    reasoning_content: 'private reasoning',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow('Provider returned reasoning without answer content.');
  });

  it('gives an actionable safe error when Hugging Face ends before answer content', async () => {
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'length',
                  message: {
                    role: 'assistant',
                    content: null,
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).rejects.toThrow('Provider response ended before an answer.');
  });

  it('does not leak secrets from Hugging Face HTTP bodies or malformed JSON', async () => {
    const token = 'test-body-secret-must-not-appear';
    const httpProvider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve(token)),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(`server body includes ${token}`, { status: 500 }),
        ),
      ),
    });
    const malformedProvider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve(token)),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(`{ malformed json includes ${token}`, { status: 200 }),
        ),
      ),
    });

    for (const provider of [httpProvider, malformedProvider]) {
      let thrown: unknown;

      try {
        await provider.explain(
          makeClarifyRequest(),
          new AbortController().signal,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toContain(token);
      expect(String((thrown as Error).cause)).not.toContain(token);
      expect(((thrown as Error).cause as Error).message).not.toContain(token);
    }
  });

  it('maps Hugging Face aborts and timeouts to safe errors', async () => {
    const abortedController = new AbortController();
    const abortProvider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.reject(new Error('fetch should not run')),
      ),
    });

    abortedController.abort();

    await expect(
      abortProvider.explain(makeClarifyRequest(), abortedController.signal),
    ).rejects.toThrow('Provider request was cancelled.');

    const timeoutProvider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: vi.fn<typeof fetch>((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
      timeoutMs: 5,
    });

    await expect(
      timeoutProvider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Provider request timed out.');
  });

  it('never reflects Hugging Face tokens from rejected fetches into errors or console output', async () => {
    const token = 'test-secret-must-not-appear';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      return undefined;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      return undefined;
    });
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve(token)),
      fetchRef: vi.fn<typeof fetch>(() =>
        Promise.reject(new Error(`network failed with ${token}`)),
      ),
    });

    let thrown: unknown;

    try {
      await provider.explain(
        makeClarifyRequest(),
        new AbortController().signal,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(token);
    expect(String((thrown as Error).cause)).not.toContain(token);
    expect(((thrown as Error).cause as Error).message).not.toContain(token);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('calls injected Hugging Face worker fetch with the global receiver', async () => {
    const workerFetch: typeof fetch = function (
      this: unknown,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Bound HF fetch works.' } }],
          }),
          { status: 200 },
        ),
      );
    };
    const provider = new HuggingFaceProvider({
      getToken: vi.fn(() => Promise.resolve('test-unit-secret')),
      fetchRef: workerFetch,
    });

    await expect(
      provider.explain(makeClarifyRequest(), new AbortController().signal),
    ).resolves.toMatchObject({
      answerMarkdown: 'Bound HF fetch works.',
    });
  });

  it('routes clarify messages through the background provider without handling unrelated messages', async () => {
    const explainMock = vi.fn<ClarificationProvider['explain']>(() =>
      Promise.resolve({
        answerMarkdown: 'TTL means time to live.',
        provider: {
          id: 'sidenote-api',
          model: 'Qwen/Qwen3-8B',
          endpointLabel: 'Sidenote API',
        },
      }),
    );
    const provider: ClarificationProvider = {
      id: 'sidenote-api',
      explain: explainMock,
      healthCheck: vi.fn<ClarificationProvider['healthCheck']>(() =>
        Promise.resolve({ ok: true, failures: [] }),
      ),
    };

    await expect(
      handleRuntimeMessage({ type: 'other' }, provider),
    ).resolves.toBeNull();
    await expect(
      handleRuntimeMessage(
        {
          type: CLARIFY_MESSAGE_TYPE,
          requestId: 'clarify-unit',
          request: makeClarifyRequest(),
        },
        provider,
      ),
    ).resolves.toMatchObject({
      ok: true,
      response: {
        answerMarkdown: 'TTL means time to live.',
      },
    });
    expect(explainMock).toHaveBeenCalledTimes(1);
  });

  it('routes through the background service worker to the configured Hugging Face provider and secret storage', async () => {
    const storageArea = createMemoryStorage();
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Background HF answer.' } }],
          }),
          { status: 200 },
        ),
      ),
    );

    vi.stubGlobal('chrome', { runtime: {} });
    vi.stubGlobal('fetch', fetchMock);
    await updateProviderSettings(
      {
        activeProviderId: 'huggingface',
        sidenoteApiBaseUrl: 'https://api.sidenote.test',
        huggingFaceRouterBaseUrl: 'https://evil.example/v1',
        huggingFacePresetId: DEFAULT_HUGGING_FACE_PRESET_ID,
        defaultModel: 'Custom/Clarifier',
        defaultExplainQuestion: DEFAULT_EXPLAIN_QUESTION,
        notesPanelSide: 'right',
        byokPresets: [
          {
            id: DEFAULT_HUGGING_FACE_PRESET_ID,
            providerId: 'huggingface',
            label: 'Hugging Face',
            baseUrl: DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
            model: 'Custom/Clarifier',
            apiKeyStorageKey: getProviderSecretKey(
              DEFAULT_HUGGING_FACE_PRESET_ID,
            ),
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      storageArea,
    );
    await setProviderSecret(
      DEFAULT_HUGGING_FACE_PRESET_ID,
      'test-background-secret',
      storageArea,
    );

    await expect(
      handleRuntimeMessage(
        {
          type: CLARIFY_MESSAGE_TYPE,
          requestId: 'clarify-hf-routing',
          request: makeClarifyRequest(),
        },
        undefined,
        new Map(),
        storageArea,
      ),
    ).resolves.toMatchObject({
      ok: true,
      response: {
        answerMarkdown: 'Background HF answer.',
        provider: {
          id: 'huggingface',
          model: 'Custom/Clarifier',
        },
      },
    });
    const requestBody = fetchMock.mock.calls[0][1]?.body;

    if (typeof requestBody !== 'string') {
      throw new Error('Expected Hugging Face request body.');
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://router.huggingface.co/v1/chat/completions',
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-background-secret',
    });
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'Custom/Clarifier',
    });
  });
});

function makeClarifyRequest(
  overrides: Partial<ClarifyRequest> = {},
): ClarifyRequest {
  return {
    highlightedText: 'TTL',
    question: DEFAULT_EXPLAIN_QUESTION,
    context: 'Assistant: volatile-lru only evicts keys with TTL metadata.',
    conversationId: 'phase-4-unit',
    messageKey: 'assistant-2',
    source: {
      site: 'chatgpt',
      url: 'https://chatgpt.com/c/phase-4-unit',
    },
    model: DEFAULT_CLARIFY_MODEL,
    ...overrides,
  };
}

function createMemoryStorage(): ChromeStorageAreaLike {
  const values = new Map<string, unknown>();

  return {
    get(keys, callback) {
      if (typeof keys === 'string') {
        callback({ [keys]: values.get(keys) });
        return;
      }

      callback({});
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, value);
      }

      callback?.();
    },
    remove(keys, callback) {
      const keysToRemove = Array.isArray(keys) ? keys : [keys];

      for (const key of keysToRemove) {
        values.delete(key);
      }

      callback?.();
    },
  };
}
