# Extension Permissions

The manifest keeps host access scoped to the surfaces Sidenote needs:

- `storage`: reserved for v1 annotation and pin persistence, panel preferences, default Explain question text, provider settings, and user-provided provider secrets via `chrome.storage.local`.
- `https://chatgpt.com/*`: limits the content script and page access to ChatGPT, the only v1 supported site.
- `https://router.huggingface.co/*`: lets the default direct Hugging Face BYOK provider route Explain/Ask through Hugging Face's OpenAI-compatible router with the user's token stored in secret storage.
- `https://api.sidenote.app/*`: keeps the later Sidenote clarification API backend option available for Explain/Ask answers.

The extension does not request broad host access, cookie access, or tab access.
