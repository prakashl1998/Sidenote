# Sidenote

Sidenote is a Chrome extension for ChatGPT that lets you highlight text in an assistant response and keep a small, anchored note beside it. You can explain a selected passage, ask a follow-up about that exact text, save a highlight, or pin a full assistant response without adding hidden messages to the ChatGPT conversation.

The current version includes the complete core extension experience: selection UI, robust anchoring, saved highlights, pinned responses, a per-conversation Notes panel, provider-backed Explain/Ask, provider settings, reliability hardening, and packaging-ready polish.

## Features

- Highlight text inside visible ChatGPT assistant responses.
- Use `Explain` for a short provider-generated clarification of the selected text.
- Use `Ask` for a custom question about the selected passage.
- Save highlighted passages locally without using an AI provider.
- Pin full assistant responses for later reference.
- View per-conversation notes in a docked Notes panel with `Questions`, `Saved`, `Pinned`, and `Couldn't re-locate` sections.
- Click a note or pin to jump back to the source message.
- Collapse, expand, retry, and delete clarification bubbles.
- Re-anchor highlights and bubbles across reloads and ChatGPT re-renders.
- Surface orphaned highlights instead of silently dropping them when source text can no longer be found.
- Configure provider status, Hugging Face BYOK token, default Explain question, Notes panel side, clear notes data, and reset provider settings.
- Keep Save, Pin, Notes, and highlight rendering working even when the AI provider is unavailable.

## How It Works

Sidenote runs as a Manifest V3 extension with three main pieces:

- `src/entrypoints/content.ts` loads the ChatGPT content script.
- `src/content/` owns selection detection, the Shadow DOM overlay, highlights, pinned bubbles, pin controls, and the Notes panel.
- `src/entrypoints/background.ts` runs the background service worker and routes provider requests.
- `src/shared/` contains typed storage, provider contracts, request building, health checks, and runtime messaging.
- `src/options/provider-options-page.ts` renders the extension settings page.

Explain and Ask are provider-backed. The current default path is direct Hugging Face BYOK through Hugging Face's OpenAI-compatible router using `Qwen/Qwen3-8B`. The Sidenote API client is also present as a future production backend option.

Sidenote does not use the ChatGPT composer for clarifications and does not insert side questions into the active conversation.

## Privacy Model

Save, Pin, Notes, highlights, panel preferences, and the default Explain prompt are stored locally in `chrome.storage.local`.

Explain and Ask send only the highlighted text, the user's question, nearby visible context, source identifiers, and selected model to the configured AI provider. Sidenote does not read ChatGPT cookies, passwords, auth tokens, hidden page state, or other tabs.

For Hugging Face BYOK, your token is stored separately under a dedicated provider secret key and is used by the background service worker only in the provider `Authorization` header. It is not copied into annotations, provider metadata, UI labels, logs, or tests.

See also:

- [docs/PRIVACY.md](docs/PRIVACY.md)
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md)
- [docs/STORE_LISTING.md](docs/STORE_LISTING.md)

## Prerequisites

- Google Chrome or a Chromium-based browser.
- Node.js and npm. A current LTS version of Node is recommended.
- A Hugging Face access token if you want to use Explain/Ask with the default provider.

Save, Pin, and local Notes can be used without a provider token.

## Clone and Build

```bash
git clone <repo-url>
cd Sidenote-feature-experiments
npm install
npm run build
```

The production extension build is generated at:

```text
.output/chrome-mv3
```

For local development with WXT:

```bash
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run verify
```

End-to-end tests build the extension first:

```bash
npm run test:e2e
```

## Load It in Chrome

1. Build the extension with `npm run build`.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select the `.output/chrome-mv3` folder from this repo.
6. Open or reload `https://chatgpt.com`.
7. Select text inside a ChatGPT assistant response. The Sidenote action bar should appear.

If you rebuild, return to `chrome://extensions` and click the reload button on the Sidenote extension card.

## Configure Hugging Face BYOK

1. Load the extension in Chrome.
2. Open the Sidenote settings page from the Notes panel provider settings, or from Chrome's extension details page.
3. Paste your Hugging Face token into `Hugging Face token`.
4. Click `Save token`.
5. Return to ChatGPT, select text in an assistant response, and click `Explain` or `Ask`.

The default provider endpoint is:

```text
https://router.huggingface.co/v1
```

The default model is:

```text
Qwen/Qwen3-8B
```

## Use Sidenote

1. Open a ChatGPT conversation.
2. Highlight text in an assistant message.
3. Choose one of the action bar buttons:
   - `Explain`: sends the highlighted text and nearby context to the configured provider and pins the answer beside the highlight.
   - `Ask`: lets you type a custom question about the selection.
   - `Save`: stores the selected passage locally without a provider call.
4. Use the Notes panel to review saved passages, questions, pinned responses, and orphaned notes.
5. Use pin controls on assistant messages to store full responses.

The first Explain or Ask shows a privacy disclosure because those actions send selected context to the configured provider. Saves and pins stay local.

## Permissions

The extension intentionally keeps permissions narrow:

- `storage` for local notes, highlights, pins, provider settings, and provider secrets.
- `https://chatgpt.com/*` for the v1 supported site.
- `https://router.huggingface.co/*` for the default Hugging Face BYOK provider.
- `https://api.sidenote.app/*` for the optional future Sidenote API provider.

It does not request broad `<all_urls>` access, cookie access, tab access, or login automation permissions.

## Project Structure

```text
src/
  entrypoints/         Chrome extension entrypoints
  background/          Provider routing and service worker logic
  content/             ChatGPT overlay, controllers, anchoring, rendering
  options/             Extension settings page
  shared/              Models, storage, providers, messaging, health
tests/
  unit/                Pure logic tests
  integration/         DOM and mocked provider flows
  e2e/                 Playwright extension tests
docs/                  Store, privacy, and permissions copy
```

## Release Checklist

Before publishing or sharing a build:

```bash
npm run verify
npm run test:e2e
```

Then run the manual checklist in [tests/MANUAL_QA.md](tests/MANUAL_QA.md).

## Notes for Contributors

- Keep ChatGPT-specific DOM behavior inside the site adapter layer.
- Keep provider HTTP calls in the background/provider layer, not in content controllers.
- Do not add broad host permissions.
- Do not store or log provider API keys outside the dedicated secret storage path.
- Do not reintroduce same-thread ChatGPT prompt injection for Explain/Ask.
- Update [docs/PERMISSIONS.md](docs/PERMISSIONS.md) whenever permissions change.

## License

This repository is currently marked `UNLICENSED` in [package.json](package.json). Add a license before publishing the project as open source.
