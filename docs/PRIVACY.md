# Sidenote Privacy Notes

Sidenote keeps Save, Pin, Notes, highlight rendering, panel side, and default Explain prompt preferences local in `chrome.storage.local`.

Explain and Ask are provider-backed. When the user explicitly clicks Explain or Ask, Sidenote sends only the highlighted text, the question, nearby visible context, conversation/message identifiers, source URL, and selected model to the configured provider.

For the default Hugging Face BYOK path, the user's token is read by the background service worker and sent only in the provider `Authorization` header. The token is stored under a dedicated `secret:provider:{presetId}` key and is not copied into notes, annotation metadata, UI labels, logs, or tests.

Sidenote does not read cookies, passwords, ChatGPT auth tokens, hidden page state, or other tabs. It does not create hidden ChatGPT prompts or same-thread side messages for Explain/Ask.
