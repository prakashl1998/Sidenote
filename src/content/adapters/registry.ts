import { createChatGptAdapter } from './chatgpt-adapter';
import type { SiteAdapter } from './types';

export function getActiveAdapter(
  locationRef: Location = location,
  documentRef: Document = document,
): SiteAdapter | null {
  const adapter = createChatGptAdapter(locationRef, documentRef);

  return adapter.matches() ? adapter : null;
}
