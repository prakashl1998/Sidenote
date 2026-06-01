import { describe, expect, it } from 'vitest';

import { mountOverlayRoot } from '../../src/content/overlay-root';

describe('Phase 0 overlay scaffold', () => {
  it('mounts one shadow-DOM overlay with a visible debug dot', () => {
    const documentRef =
      document.implementation.createHTMLDocument('Sidenote test');

    const firstRoot = mountOverlayRoot(documentRef);
    const secondRoot = mountOverlayRoot(documentRef);

    const host = documentRef.getElementById('sidenote-overlay-root');
    const dot = firstRoot.querySelector('#sidenote-debug-dot');
    const style = firstRoot.querySelector('style')?.textContent ?? '';

    expect(host).toBeInstanceOf(HTMLDivElement);
    expect(host?.dataset.sidenoteOverlay).toBe('true');
    expect(firstRoot).toBe(secondRoot);
    expect(dot).toBeInstanceOf(HTMLDivElement);
    expect(style).toContain('position: fixed');
    expect(style).toContain('background: #16a34a');
  });
});
