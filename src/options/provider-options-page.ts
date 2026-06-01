import {
  DEFAULT_EXPLAIN_QUESTION,
  DEFAULT_HUGGING_FACE_PRESET_ID,
  DEFAULT_HUGGING_FACE_ROUTER_BASE_URL,
} from '../shared/providers/constants';
import { getActiveClarificationProvider } from '../shared/providers/registry';
import {
  clearConversationRecords,
  getProviderSecret,
  getProviderSettings,
  removeProviderSecret,
  resetProviderSettings,
  setProviderSecret,
  type ChromeStorageAreaLike,
  updateProviderSettings,
} from '../shared/storage';

export interface ProviderOptionsPageOptions {
  documentRef?: Document;
  storageArea?: ChromeStorageAreaLike;
}

export function renderProviderOptionsPage(
  options: ProviderOptionsPageOptions = {},
): void {
  const documentRef = options.documentRef ?? document;
  const root =
    documentRef.getElementById('app') ??
    documentRef.body.appendChild(documentRef.createElement('main'));

  root.replaceChildren();
  documentRef.head.append(createStyles(documentRef));

  const page = documentRef.createElement('section');
  page.className = 'sidenote-options-page';

  const heading = documentRef.createElement('h1');
  heading.textContent = 'Sidenote Settings';

  const status = documentRef.createElement('p');
  status.className = 'sidenote-options-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Checking provider...';

  const provider = documentRef.createElement('p');
  provider.className = 'sidenote-options-detail';

  const model = documentRef.createElement('p');
  model.className = 'sidenote-options-detail';

  const panelSide = documentRef.createElement('p');
  panelSide.className = 'sidenote-options-detail';

  const questionLabel = documentRef.createElement('label');
  questionLabel.textContent = 'Default Explain question';

  const questionInput = documentRef.createElement('input');
  questionInput.type = 'text';
  questionInput.autocomplete = 'off';
  questionInput.setAttribute('aria-label', 'Default Explain question');
  questionLabel.append(questionInput);

  const questionSave = documentRef.createElement('button');
  questionSave.type = 'button';
  questionSave.textContent = 'Save question';
  questionSave.setAttribute('aria-label', 'Save default Explain question');

  const sideControls = documentRef.createElement('div');
  sideControls.className = 'sidenote-options-controls';

  const leftSide = documentRef.createElement('button');
  leftSide.type = 'button';
  leftSide.textContent = 'Left panel';
  leftSide.setAttribute('aria-label', 'Use left notes panel');

  const rightSide = documentRef.createElement('button');
  rightSide.type = 'button';
  rightSide.textContent = 'Right panel';
  rightSide.setAttribute('aria-label', 'Use right notes panel');

  sideControls.append(leftSide, rightSide);

  const form = documentRef.createElement('form');
  form.className = 'sidenote-options-form';

  const label = documentRef.createElement('label');
  label.textContent = 'Hugging Face token';

  const input = documentRef.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = 'hf_...';
  input.setAttribute('aria-label', 'Hugging Face token');

  const controls = documentRef.createElement('div');
  controls.className = 'sidenote-options-controls';

  const save = documentRef.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save token';
  save.setAttribute('aria-label', 'Save token');

  const remove = documentRef.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove token';
  remove.setAttribute('aria-label', 'Remove token');

  controls.append(save, remove);
  label.append(input);
  form.append(label, controls, questionLabel, questionSave);

  const dataControls = documentRef.createElement('div');
  dataControls.className = 'sidenote-options-controls';

  const clearData = documentRef.createElement('button');
  clearData.type = 'button';
  clearData.textContent = 'Clear notes data';
  clearData.setAttribute('aria-label', 'Clear notes data');

  const resetProvider = documentRef.createElement('button');
  resetProvider.type = 'button';
  resetProvider.textContent = 'Reset provider settings';
  resetProvider.setAttribute('aria-label', 'Reset provider settings');

  dataControls.append(clearData, resetProvider);
  page.append(
    heading,
    status,
    provider,
    model,
    panelSide,
    sideControls,
    form,
    dataControls,
  );
  root.append(page);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveToken();
  });
  remove.addEventListener('click', () => {
    void removeToken();
  });
  questionSave.addEventListener('click', () => {
    void saveDefaultQuestion();
  });
  leftSide.addEventListener('click', () => {
    void savePanelSide('left');
  });
  rightSide.addEventListener('click', () => {
    void savePanelSide('right');
  });
  clearData.addEventListener('click', () => {
    void clearNotesData();
  });
  resetProvider.addEventListener('click', () => {
    void resetProviderConfiguration();
  });

  void refresh();

  async function refresh(): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);
    const presetId =
      settings.huggingFacePresetId ?? DEFAULT_HUGGING_FACE_PRESET_ID;
    const preset = settings.byokPresets.find(
      (candidate) => candidate.id === presetId,
    );
    const health = await getActiveClarificationProvider(options.storageArea)
      .then((activeProvider) => activeProvider.healthCheck())
      .catch((error: unknown) => ({
        ok: false,
        failures: [error instanceof Error ? error.message : String(error)],
      }));
    const hasToken = Boolean(
      await getProviderSecret(presetId, options.storageArea),
    );

    status.dataset.providerStatus = health.ok ? 'ready' : 'blocked';
    status.textContent = `Status: ${
      health.ok ? 'Ready' : (health.failures[0] ?? 'Provider unavailable.')
    }`;
    provider.textContent = `Provider: Hugging Face (${preset?.baseUrl ?? DEFAULT_HUGGING_FACE_ROUTER_BASE_URL})`;
    model.textContent = `Model: ${preset?.model ?? settings.defaultModel}`;
    panelSide.textContent = `Notes panel: ${settings.notesPanelSide} side`;
    questionInput.value =
      settings.defaultExplainQuestion || DEFAULT_EXPLAIN_QUESTION;
    input.placeholder = hasToken ? 'Token saved' : 'hf_...';
  }

  async function saveToken(): Promise<void> {
    const token = input.value.trim();

    if (token.length === 0) {
      return;
    }

    const settings = await getProviderSettings(options.storageArea);

    await setProviderSecret(getPresetId(settings), token, options.storageArea);
    input.value = '';
    await refresh();
  }

  async function removeToken(): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);

    input.value = '';
    await removeProviderSecret(getPresetId(settings), options.storageArea);
    await refresh();
  }

  async function saveDefaultQuestion(): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);
    const nextQuestion = questionInput.value.trim() || DEFAULT_EXPLAIN_QUESTION;

    await updateProviderSettings(
      {
        ...settings,
        defaultExplainQuestion: nextQuestion,
      },
      options.storageArea,
    );
    await refresh();
  }

  async function savePanelSide(side: 'left' | 'right'): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);

    await updateProviderSettings(
      {
        ...settings,
        notesPanelSide: side,
      },
      options.storageArea,
    );
    await refresh();
  }

  async function clearNotesData(): Promise<void> {
    await clearConversationRecords(options.storageArea);
    status.dataset.providerStatus = 'ready';
    status.textContent = 'Status: Local notes data cleared.';
  }

  async function resetProviderConfiguration(): Promise<void> {
    await resetProviderSettings(options.storageArea);
    input.value = '';
    await refresh();
  }
}

function getPresetId(settings: { huggingFacePresetId?: string }): string {
  return settings.huggingFacePresetId ?? DEFAULT_HUGGING_FACE_PRESET_ID;
}

function createStyles(documentRef: Document): HTMLStyleElement {
  const style = documentRef.createElement('style');
  style.textContent = `
    body {
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family:
        ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
    }

    .sidenote-options-page {
      max-width: 560px;
      padding: 32px;
    }

    .sidenote-options-page h1,
    .sidenote-options-page p {
      margin: 0;
    }

    .sidenote-options-page h1 {
      font-size: 22px;
      line-height: 1.25;
    }

    .sidenote-options-status,
    .sidenote-options-detail {
      padding-top: 10px;
      color: #475569;
      font-size: 14px;
      line-height: 1.4;
    }

    .sidenote-options-status[data-provider-status="ready"] {
      color: #166534;
      font-weight: 750;
    }

    .sidenote-options-status[data-provider-status="blocked"] {
      color: #991b1b;
      font-weight: 750;
    }

    .sidenote-options-form {
      display: grid;
      gap: 12px;
      padding-top: 22px;
    }

    .sidenote-options-form label {
      display: grid;
      gap: 8px;
      color: #334155;
      font-size: 13px;
      font-weight: 750;
      line-height: 1.2;
    }

    .sidenote-options-form label + button {
      width: fit-content;
    }

    .sidenote-options-form input {
      height: 36px;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 6px;
      padding: 0 10px;
      color: #111827;
      font: inherit;
    }

    .sidenote-options-controls {
      display: flex;
      gap: 8px;
    }

    .sidenote-options-controls button {
      height: 34px;
      border: 0;
      border-radius: 6px;
      padding: 0 12px;
      background: #f1f5f9;
      color: #334155;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      cursor: pointer;
    }

    .sidenote-options-controls button:first-child {
      background: #2563eb;
      color: #ffffff;
    }

    .sidenote-options-controls button:focus-visible,
    .sidenote-options-form input:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
  `;
  return style;
}

if ((globalThis as { chrome?: unknown }).chrome) {
  renderProviderOptionsPage();
}
