# Chrome Web Store Listing Draft

## Short Description

Highlight text in ChatGPT answers and keep concise side notes, saved passages, and pinned responses anchored to the original reply.

## Detailed Description

Sidenote adds a focused clarification layer to ChatGPT. Select text inside an assistant response, then explain it, ask a follow-up about that exact passage, save the passage, or pin the whole response for later review.

Clarifications appear in a small pinned bubble next to the highlighted text, so the main ChatGPT conversation stays untouched. Saved highlights and pinned responses remain local in Chrome storage and appear in the per-conversation Notes panel.

Sidenote currently supports ChatGPT only. Explain and Ask use the configured AI provider. The default provider option is Hugging Face BYOK through Hugging Face's OpenAI-compatible router with the `Qwen/Qwen3-8B` model. Users provide and control their own provider token.

## Privacy Copy

Explain and Ask send the selected text, the user's question, and nearby visible ChatGPT context to the configured AI provider. Sidenote does not send ChatGPT cookies, passwords, auth tokens, hidden page state, or content from other tabs.

Save, Pin, Notes, highlights, and panel preferences are stored locally with `chrome.storage.local`. Provider API keys are stored separately from notes and are never written into annotations, provider metadata, logs, or exported copy.

## Permissions Copy

Sidenote requests `storage` to save local notes, highlights, pins, provider settings, and user-provided provider secrets. Host access is limited to `https://chatgpt.com/*`, `https://router.huggingface.co/*`, and `https://api.sidenote.app/*`.

Sidenote does not request broad `<all_urls>` access, cookie access, tab access, or permissions to automate login.
