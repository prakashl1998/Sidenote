export const DEFAULT_CLARIFY_MODEL = 'Qwen/Qwen3-8B';
export const DEFAULT_EXPLAIN_QUESTION =
  'What does this mean and why is it here?';
export const DEFAULT_SIDENOTE_API_BASE_URL = 'https://api.sidenote.app';
export const DEFAULT_HUGGING_FACE_ROUTER_BASE_URL =
  'https://router.huggingface.co/v1';
export const DEFAULT_HUGGING_FACE_PRESET_ID = 'huggingface-default';

export function normalizeHuggingFaceRouterBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_HUGGING_FACE_ROUTER_BASE_URL;
  }

  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/u, '');

    if (
      url.protocol === 'https:' &&
      url.hostname === 'router.huggingface.co' &&
      pathname === '/v1'
    ) {
      return DEFAULT_HUGGING_FACE_ROUTER_BASE_URL;
    }
  } catch {
    return DEFAULT_HUGGING_FACE_ROUTER_BASE_URL;
  }

  return DEFAULT_HUGGING_FACE_ROUTER_BASE_URL;
}
