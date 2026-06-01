const OVERLAY_HOST_ID = 'sidenote-overlay-root';
const DEBUG_DOT_ID = 'sidenote-debug-dot';

export function mountOverlayRoot(documentRef: Document = document): ShadowRoot {
  const existingHost = documentRef.getElementById(OVERLAY_HOST_ID);

  if (existingHost?.shadowRoot) {
    return existingHost.shadowRoot;
  }

  const host = documentRef.createElement('div');
  host.id = OVERLAY_HOST_ID;
  host.dataset.sidenoteOverlay = 'true';
  documentRef.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.append(createStyles(documentRef), createDebugDot(documentRef));

  return shadowRoot;
}

function createStyles(documentRef: Document): HTMLStyleElement {
  const style = documentRef.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }

    #${DEBUG_DOT_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: 14px;
      height: 14px;
      border: 2px solid #ffffff;
      border-radius: 999px;
      background: #16a34a;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.32);
      pointer-events: none;
    }

    #sidenote-action-bar {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      gap: 6px;
      align-items: center;
      width: 176px;
      height: 42px;
      box-sizing: border-box;
      padding: 6px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.24);
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      pointer-events: auto;
    }

    #sidenote-action-bar[hidden] {
      display: none;
    }

    #sidenote-action-bar button {
      flex: 1 1 0;
      min-width: 0;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: #f3f4f6;
      color: #111827;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      line-height: 1;
      cursor: pointer;
    }

    #sidenote-action-bar button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    #sidenote-action-bar button:disabled {
      color: #94a3b8;
      cursor: not-allowed;
      opacity: 0.64;
    }

    #sidenote-orphan-status {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 2147483647;
      max-width: 280px;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid rgba(146, 64, 14, 0.24);
      border-radius: 8px;
      background: #fff7ed;
      color: #7c2d12;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.3;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      pointer-events: none;
    }

    #sidenote-orphan-status[hidden] {
      display: none;
    }

    #sidenote-provider-degraded-banner {
      position: fixed;
      left: 18px;
      top: 18px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 36px));
      box-sizing: border-box;
      padding: 9px 11px;
      border: 1px solid rgba(153, 27, 27, 0.2);
      border-radius: 8px;
      background: #fef2f2;
      color: #991b1b;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
      pointer-events: none;
    }

    #sidenote-provider-degraded-banner[hidden] {
      display: none;
    }

    #sidenote-notes-toggle {
      position: fixed;
      right: 18px;
      top: 88px;
      z-index: 2147483647;
      height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(15, 23, 42, 0.16);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      cursor: pointer;
      pointer-events: auto;
    }

    #sidenote-notes-toggle[data-panel-side="left"] {
      right: auto;
      left: 18px;
    }

    #sidenote-notes-panel {
      position: fixed;
      right: 18px;
      top: 132px;
      z-index: 2147483647;
      width: min(320px, calc(100vw - 36px));
      max-height: calc(100vh - 168px);
      box-sizing: border-box;
      overflow: auto;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
      pointer-events: auto;
    }

    #sidenote-notes-panel[data-panel-side="left"] {
      right: auto;
      left: 18px;
    }

    #sidenote-notes-panel[hidden] {
      display: none;
    }

    #sidenote-notes-panel h2,
    #sidenote-notes-panel h3,
    #sidenote-notes-panel p,
    #sidenote-notes-panel ul {
      margin: 0;
    }

    #sidenote-notes-panel h2 {
      font-size: 15px;
      line-height: 1.25;
    }

    .sidenote-notes-section {
      padding-top: 12px;
    }

    .sidenote-notes-section h3 {
      padding-bottom: 6px;
      color: #475569;
      font-size: 11px;
      font-weight: 750;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .sidenote-notes-list {
      display: grid;
      gap: 6px;
      padding: 0;
      list-style: none;
    }

    .sidenote-notes-list li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      align-items: center;
    }

    .sidenote-notes-row-main,
    .sidenote-notes-row-delete {
      min-width: 0;
      height: 30px;
      border: 0;
      border-radius: 6px;
      font-family: inherit;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
    }

    .sidenote-notes-row-main {
      overflow: hidden;
      padding: 0 9px;
      background: #f8fafc;
      color: #111827;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidenote-notes-row-delete {
      padding: 0 8px;
      background: #fee2e2;
      color: #991b1b;
      font-weight: 700;
    }

    .sidenote-notes-empty {
      padding: 8px 0;
      color: #64748b;
      font-size: 12px;
      line-height: 1.3;
    }

    .sidenote-limitation {
      padding-top: 6px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.35;
    }

    .sidenote-provider-settings-button {
      width: 100%;
      height: 30px;
      margin-top: 10px;
      border: 0;
      border-radius: 6px;
      background: #e0f2fe;
      color: #0c4a6e;
      font-family: inherit;
      font-size: 12px;
      font-weight: 750;
      line-height: 1;
      cursor: pointer;
    }

    .sidenote-panel-side-button {
      width: 100%;
      height: 30px;
      margin-top: 8px;
      border: 0;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      font-family: inherit;
      font-size: 12px;
      font-weight: 750;
      line-height: 1;
      cursor: pointer;
    }

    #sidenote-pin-controls {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    .sidenote-pin-button {
      position: fixed;
      width: 44px;
      height: 28px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16);
      cursor: pointer;
      opacity: 0.72;
      pointer-events: auto;
    }

    .sidenote-pin-button:hover,
    .sidenote-pin-button:focus-visible,
    #sidenote-notes-toggle:focus-visible,
    .sidenote-provider-settings-button:focus-visible,
    .sidenote-panel-side-button:focus-visible,
    .sidenote-notes-row-main:focus-visible,
    .sidenote-notes-row-delete:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
      opacity: 1;
    }

    #sidenote-provider-settings {
      position: fixed;
      right: 18px;
      top: 132px;
      z-index: 2147483647;
      width: min(320px, calc(100vw - 36px));
      box-sizing: border-box;
      padding: 14px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
      pointer-events: auto;
    }

    #sidenote-provider-settings[hidden] {
      display: none;
    }

    #sidenote-provider-settings h2,
    #sidenote-provider-settings p {
      margin: 0;
    }

    #sidenote-provider-settings h2 {
      padding-bottom: 8px;
      font-size: 15px;
      line-height: 1.25;
    }

    .sidenote-provider-status,
    .sidenote-provider-detail {
      padding-top: 5px;
      color: #475569;
      font-size: 12px;
      line-height: 1.35;
    }

    .sidenote-provider-status[data-provider-status="ready"] {
      color: #166534;
      font-weight: 750;
    }

    .sidenote-provider-status[data-provider-status="blocked"] {
      color: #991b1b;
      font-weight: 750;
    }

    .sidenote-provider-token-form {
      display: grid;
      gap: 8px;
      padding-top: 12px;
    }

    .sidenote-provider-token-form label {
      display: grid;
      gap: 6px;
      color: #334155;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
    }

    .sidenote-provider-token-form input {
      width: 100%;
      height: 32px;
      box-sizing: border-box;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 6px;
      padding: 0 8px;
      color: #111827;
      font: inherit;
      font-weight: 500;
    }

    .sidenote-provider-token-controls {
      display: flex;
      gap: 6px;
    }

    .sidenote-provider-options-button,
    .sidenote-provider-token-controls button,
    .sidenote-privacy-disclosure-controls button {
      height: 30px;
      border: 0;
      border-radius: 6px;
      padding: 0 10px;
      background: #f1f5f9;
      color: #334155;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      font-size: 12px;
      font-weight: 750;
      line-height: 1;
      cursor: pointer;
    }

    .sidenote-provider-options-button {
      width: 100%;
      margin-top: 12px;
      background: #2563eb;
      color: #ffffff;
    }

    .sidenote-provider-token-controls button:first-child,
    .sidenote-privacy-disclosure-controls button:first-child {
      background: #2563eb;
      color: #ffffff;
    }

    .sidenote-provider-options-button:focus-visible,
    .sidenote-provider-token-controls button:focus-visible,
    .sidenote-provider-token-form input:focus-visible,
    .sidenote-privacy-disclosure-controls button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    .sidenote-privacy-disclosure {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      background: rgba(15, 23, 42, 0.28);
      pointer-events: auto;
    }

    .sidenote-privacy-disclosure-box {
      width: min(360px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 16px;
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.26);
    }

    .sidenote-privacy-disclosure-box p {
      margin: 0;
      color: #334155;
      font-size: 13px;
      line-height: 1.4;
    }

    .sidenote-privacy-disclosure-controls {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding-top: 14px;
    }

    #sidenote-ask-bubbles {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    .sidenote-ask-bubble {
      position: fixed;
      width: 300px;
      max-width: calc(100vw - 24px);
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid rgba(15, 23, 42, 0.16);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.22);
      pointer-events: auto;
    }

    .sidenote-ask-bubble-header {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 6px;
    }

    .sidenote-ask-bubble-status {
      color: #475569;
      font-size: 11px;
      font-weight: 750;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .sidenote-ask-bubble-controls {
      display: flex;
      flex: 0 0 auto;
      gap: 4px;
    }

    .sidenote-ask-bubble-controls button {
      height: 24px;
      padding: 0 7px;
      border: 0;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
    }

    .sidenote-ask-bubble-controls button:focus-visible,
    .sidenote-ask-marker:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    .sidenote-ask-bubble-body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 13px;
      line-height: 1.4;
    }

    .sidenote-ask-marker {
      position: fixed;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 2px solid #ffffff;
      border-radius: 999px;
      background: #2563eb;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.38);
      cursor: pointer;
      pointer-events: auto;
    }
  `;
  return style;
}

function createDebugDot(documentRef: Document): HTMLDivElement {
  const dot = documentRef.createElement('div');
  dot.id = DEBUG_DOT_ID;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
