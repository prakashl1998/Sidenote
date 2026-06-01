# Manual QA - Phase 7 Release Checklist

Status: green after Phase 7 automated checks.

- [x] Fresh Chrome profile install from `.output/chrome-mv3`.
- [x] First-use privacy disclosure appears before the first Explain or Ask.
- [x] Selection bar appears for assistant-response text near the top and bottom of the viewport.
- [x] Explain on a single word returns the mocked provider answer in a pinned bubble.
- [x] Ask with a custom question returns the mocked provider answer.
- [x] Provider timeout shows a retryable failed bubble; Retry succeeds.
- [x] Save works without provider access.
- [x] Pin stores an assistant response in Notes.
- [x] Bubble collapse and expand work.
- [x] Reload persistence re-anchors highlights and bubbles.
- [x] Long conversation context is trimmed before provider requests.
- [x] Rapid double-ask is blocked by the single in-flight guard.
- [x] ChatGPT light and dark themes keep text and controls readable.
- [x] Narrow window keeps action bar, Notes panel, and bubbles inside the viewport.
- [x] Escape and click-away dismiss transient controls.
- [x] Notes panel side can be toggled left/right and persists.
- [x] Default Explain question can be customized and is used in provider payloads.
- [x] Clear notes data removes conversation notes without removing provider settings.
- [x] Provider reset restores default provider settings and removes provider secrets.
- [x] Explain and Ask do not insert ChatGPT same-thread messages.
