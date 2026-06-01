import { getActiveAdapter } from './adapters/registry';
import type { AssistantMessageRef } from './adapters/types';
import { ActionBarController } from './controllers/action-bar';
import { AskBubblesController } from './controllers/ask-bubbles';
import { NotesPanelController } from './controllers/notes-panel';
import { PinControlsController } from './controllers/pin-controls';
import {
  ProviderSettingsController,
  type ProviderStatusViewModel,
} from './controllers/provider-settings';
import { resolveTextAnchor } from './anchoring';
import { HighlightRenderer } from './highlight-renderer';
import { mountOverlayRoot } from './overlay-root';
import { SelectionController } from './selection';
import type {
  AskProviderMetadata,
  ConversationRecord,
  PinnedResponse,
  ProviderSettings,
  StoredAnnotation,
} from '../shared/models';
import { reportBreakage, reportProviderFailure } from '../shared/health';
import type { ClarifyResponse } from '../shared/providers/types';
import {
  buildClarifyRequest,
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_EXPLAIN_QUESTION,
} from '../shared/clarify-request';
import {
  openProviderOptions,
  requestClarification,
  requestProviderStatus,
  type RuntimeMessageSender,
} from '../shared/messaging';
import {
  type ChromeStorageAreaLike,
  getConversation,
  getProviderSettings,
  removeAnnotation,
  removePin,
  upsertAnnotation,
  upsertPin,
  updateProviderSettings,
} from '../shared/storage';

export interface ContentScriptBootstrapOptions {
  documentRef?: Document;
  locationRef?: Location;
  sendMessage?: RuntimeMessageSender;
  storageArea?: ChromeStorageAreaLike;
  windowRef?: Window;
}

interface ProviderHealthState {
  ok: boolean;
  label: string;
  failures: string[];
}

export function bootstrapContentScript(
  options: ContentScriptBootstrapOptions = {},
): void {
  const documentRef = options.documentRef ?? document;
  const locationRef = options.locationRef ?? location;
  const windowRef = options.windowRef ?? window;
  const shadowRoot = mountOverlayRoot(documentRef);
  const adapter = getActiveAdapter(locationRef, documentRef);

  if (!adapter) {
    return;
  }

  const activeAdapter = adapter;
  let activeSelection: { range: Range; messageKey: string } | null = null;
  let repaintTimer: number | null = null;
  let conversationUiRevision = 0;
  let mutationObserver: MutationObserver | null = null;
  let activeAskController: AbortController | null = null;
  let activeAskAnnotationId: string | null = null;
  let askInFlight = false;
  let providerHealth: ProviderHealthState | null = null;
  const deletedAnnotationIds = new Set<string>();
  const highlightRenderer = new HighlightRenderer(activeAdapter);
  const askBubbles = new AskBubblesController(
    shadowRoot,
    {
      onCollapse: (annotation) => {
        void setAnnotationCollapsed(annotation, true);
      },
      onExpand: (annotation) => {
        void setAnnotationCollapsed(annotation, false);
      },
      onDelete: (annotation) => {
        void deleteAnnotation(annotation.id);
      },
      onRetry: (annotation) => {
        void retryAskAnnotation(annotation);
      },
    },
    windowRef,
  );
  let activeConversationId = getStableConversationId();
  const providerSettings = new ProviderSettingsController(shadowRoot, {
    onRefreshStatus: () => syncProviderStatus(),
    onOpenProviderOptions: () => {
      void openProviderOptions(options.sendMessage);
    },
  });
  const notesPanel = new NotesPanelController(shadowRoot, {
    onNavigateAnnotation: (annotation) => {
      navigateToAnnotation(annotation);
    },
    onDeleteAnnotation: (annotation) => {
      void deleteAnnotation(annotation.id);
    },
    onNavigatePin: (pin) => {
      navigateToMessage(pin.messageKey);
    },
    onDeletePin: (pin) => {
      void deletePin(pin.id);
    },
    onOpenProviderSettings: () => {
      notesPanel.setOpen(false);
      providerSettings.setOpen(true);
    },
    onTogglePanelSide: (side) => {
      void saveNotesPanelSide(side);
    },
  });
  const pinControls = new PinControlsController(shadowRoot, {
    onPinMessage: (message) => {
      void pinMessage(message);
    },
  });
  const refreshConversationUi = async (): Promise<void> => {
    const revision = ++conversationUiRevision;
    syncActiveConversationId();
    const conversationId = activeConversationId;
    const record = await getConversation(conversationId, options.storageArea);

    if (
      revision === conversationUiRevision &&
      conversationId === activeConversationId
    ) {
      renderConversationUi(record);
    }
  };
  const scheduleRepaint = (): void => {
    if (repaintTimer !== null) {
      windowRef.clearTimeout(repaintTimer);
    }

    repaintTimer = windowRef.setTimeout(() => {
      repaintTimer = null;
      void refreshConversationUi();
    }, 50);
  };
  const refreshAnchoredOverlayPositions = (): void => {
    pinControls.refreshPosition();
    askBubbles.refreshPosition();
  };
  mutationObserver = new MutationObserver(scheduleRepaint);
  mutationObserver.observe(documentRef.body, {
    childList: true,
    subtree: true,
  });
  windowRef.addEventListener('popstate', scheduleRepaint);
  windowRef.addEventListener('hashchange', scheduleRepaint);
  installRouteChangeWatcher(windowRef, scheduleRepaint);
  windowRef.addEventListener('scroll', refreshAnchoredOverlayPositions, true);
  windowRef.addEventListener('resize', refreshAnchoredOverlayPositions);

  const actionBar = new ActionBarController(shadowRoot, windowRef, {
    onExplain: () => {
      void explainActiveSelection();
    },
    onAsk: () => {
      const question = windowRef.prompt('Ask about the selected text')?.trim();

      if (question) {
        void askActiveSelection(question);
      }
    },
    onSave: () => {
      void saveActiveSelection();
    },
  });
  const setProviderHealth = (status: ProviderHealthState | null): void => {
    providerHealth = status;
    updateProviderDegradedBanner(status, shadowRoot);
    actionBar.setAskEnabled(
      status?.ok !== false && !askInFlight,
      status?.label,
    );
  };
  const selectionController = new SelectionController({
    adapter: activeAdapter,
    documentRef,
    windowRef,
    isDismissalClickIgnored: (event) => actionBar.containsEvent(event),
    onSelection: ({ range, rect, messageKey }) => {
      activeSelection = { range, messageKey };
      actionBar.show(rect);
    },
    onDismiss: () => {
      activeSelection = null;
      actionBar.hide();
    },
  });

  selectionController.connect();
  void syncUiSettings();
  void refreshConversationUi();
  void syncProviderStatus();
  void providerSettings.refresh();

  async function syncUiSettings(): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);

    notesPanel.setPanelSide(settings.notesPanelSide);
  }

  async function explainActiveSelection(): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);

    await askActiveSelection(
      settings.defaultExplainQuestion || DEFAULT_EXPLAIN_QUESTION,
    );
  }

  async function saveNotesPanelSide(
    side: ProviderSettings['notesPanelSide'],
  ): Promise<void> {
    const settings = await getProviderSettings(options.storageArea);

    await updateProviderSettings(
      {
        ...settings,
        notesPanelSide: side,
      },
      options.storageArea,
    );
    await providerSettings.refresh();
  }

  function syncActiveConversationId(): boolean {
    const nextConversationId = getStableConversationId();

    if (nextConversationId === activeConversationId) {
      return false;
    }

    activeConversationId = nextConversationId;
    activeSelection = null;
    actionBar.hide();
    activeAskController?.abort();
    activeAskController = null;
    activeAskAnnotationId = null;
    askInFlight = false;
    deletedAnnotationIds.clear();
    highlightRenderer.clear();
    updateOrphanStatus(0, shadowRoot);
    notesPanel.render(null, new Set());
    askBubbles.render([], new Set());
    pinControls.render(activeAdapter.getAssistantMessages());
    return true;
  }

  async function saveActiveSelection(): Promise<void> {
    if (!activeSelection) {
      return;
    }

    if (syncActiveConversationId()) {
      return;
    }

    const resolved = activeAdapter.resolveSelection(activeSelection.range);

    if (!resolved) {
      actionBar.hide();
      activeSelection = null;
      return;
    }

    const now = Date.now();
    const conversationId = activeConversationId;
    const annotation: StoredAnnotation = {
      id: createAnnotationId(),
      conversationId,
      messageKey: resolved.message.messageKey,
      kind: 'save',
      quote: resolved.quote,
      position: resolved.position,
      color: '#fff2a8',
      collapsed: true,
      createdAt: now,
      updatedAt: now,
    };
    const record = await upsertAnnotation(annotation, options.storageArea);

    renderLatestConversationUi(record);
    actionBar.hide();
    activeSelection = null;
    documentRef.getSelection()?.removeAllRanges();
  }

  async function askActiveSelection(question: string): Promise<void> {
    if (!activeSelection || askInFlight || providerHealth?.ok === false) {
      return;
    }

    if (syncActiveConversationId()) {
      return;
    }

    askInFlight = true;
    actionBar.setAskEnabled(false, 'Another clarification is already running.');

    const selectedRange = activeSelection.range;
    const resolved = activeAdapter.resolveSelection(selectedRange);

    if (!resolved) {
      clearAskInFlight();
      actionBar.hide();
      activeSelection = null;
      return;
    }

    const settings = await getProviderSettings(options.storageArea);

    if (!(await ensurePrivacyDisclosureAccepted(settings))) {
      clearAskInFlight();
      return;
    }

    const health = await refreshProviderStatus();

    setProviderHealth(health);

    if (health?.ok === false) {
      clearAskInFlight();
      return;
    }

    const now = Date.now();
    const conversationId = activeConversationId;
    let annotation: StoredAnnotation = {
      id: createAnnotationId(),
      conversationId,
      messageKey: resolved.message.messageKey,
      kind: 'ask',
      quote: resolved.quote,
      position: resolved.position,
      color: '#bfdbfe',
      question,
      answerMarkdown: '',
      answerState: 'pending',
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    const record = await upsertAnnotation(annotation, options.storageArea);
    const askController = new AbortController();

    activeAskController = askController;
    activeAskAnnotationId = annotation.id;
    renderLatestConversationUi(record);
    actionBar.hide();
    activeSelection = null;
    documentRef.getSelection()?.removeAllRanges();

    try {
      const context = activeAdapter.getContextForMessage(
        resolved.message.messageKey,
        DEFAULT_CONTEXT_BUDGET,
      );
      const request = buildClarifyRequest({
        exact: resolved.quote.exact,
        context,
        question,
        conversationId,
        messageKey: resolved.message.messageKey,
        source: getClarifySource(locationRef, documentRef),
        model: getConfiguredModel(settings),
      });
      const response = await requestClarification(
        request,
        options.sendMessage,
        {
          signal: askController.signal,
        },
      );

      activeAskController = null;
      activeAskAnnotationId = null;
      clearAskInFlight();
      await persistAskUpdate({
        answerMarkdown: response.answerMarkdown,
        answerState: 'complete',
        answerError: undefined,
        provider: toSafeProviderMetadata(response),
      });
    } catch (error) {
      askController.abort();
      activeAskController = null;
      activeAskAnnotationId = null;
      clearAskInFlight();
      reportProviderFailure('clarify-request', getSafeErrorLabel(error));
      await persistAskUpdate({
        answerMarkdown: '',
        answerState: 'failed',
        answerError: getSafeErrorLabel(error),
      });
    }

    async function persistAskUpdate(
      patch: Pick<StoredAnnotation, 'answerMarkdown' | 'answerState'> &
        Pick<Partial<StoredAnnotation>, 'answerError' | 'provider'>,
    ): Promise<void> {
      const currentRecord = await getConversation(
        conversationId,
        options.storageArea,
      );

      if (deletedAnnotationIds.has(annotation.id)) {
        return;
      }

      const currentAnnotation = currentRecord?.annotations.find(
        (candidate) => candidate.id === annotation.id,
      );

      if (currentAnnotation?.kind !== 'ask') {
        return;
      }

      annotation = {
        ...currentAnnotation,
        ...patch,
        updatedAt: Date.now(),
      };

      const nextRecord = await upsertAnnotation(
        annotation,
        options.storageArea,
      );

      renderLatestConversationUi(nextRecord);
    }
  }

  async function pinMessage(message: AssistantMessageRef): Promise<void> {
    syncActiveConversationId();

    const now = Date.now();
    const conversationId = activeConversationId;
    const pin: PinnedResponse = {
      id: createAnnotationId(),
      conversationId,
      messageKey: message.messageKey,
      excerptMarkdown: message.text,
      label: getPinLabel(message.text),
      createdAt: now,
    };
    const record = await upsertPin(pin, options.storageArea);

    renderLatestConversationUi(record);
  }

  async function deleteAnnotation(annotationId: string): Promise<void> {
    syncActiveConversationId();
    deletedAnnotationIds.add(annotationId);

    if (annotationId === activeAskAnnotationId) {
      activeAskController?.abort();
      activeAskController = null;
      activeAskAnnotationId = null;
      clearAskInFlight();
    }

    const record = await removeAnnotation(
      activeConversationId,
      annotationId,
      options.storageArea,
    );

    renderLatestConversationUi(record);
  }

  function clearAskInFlight(): void {
    askInFlight = false;
    actionBar.setAskEnabled(
      providerHealth?.ok !== false,
      providerHealth?.label,
    );
  }

  async function setAnnotationCollapsed(
    annotation: StoredAnnotation,
    collapsed: boolean,
  ): Promise<void> {
    const record = await upsertAnnotation(
      {
        ...annotation,
        collapsed,
        updatedAt: Date.now(),
      },
      options.storageArea,
    );

    renderLatestConversationUi(record);
  }

  async function deletePin(pinId: string): Promise<void> {
    syncActiveConversationId();

    const record = await removePin(
      activeConversationId,
      pinId,
      options.storageArea,
    );

    renderLatestConversationUi(record);
  }

  async function retryAskAnnotation(
    annotation: StoredAnnotation,
  ): Promise<void> {
    if (askInFlight || activeAskController || annotation.kind !== 'ask') {
      return;
    }

    syncActiveConversationId();

    if (annotation.conversationId !== activeConversationId) {
      return;
    }

    askInFlight = true;
    actionBar.setAskEnabled(false, 'Another clarification is already running.');
    const conversationId = annotation.conversationId;

    const health = await refreshProviderStatus();

    setProviderHealth(health);

    if (health?.ok === false) {
      clearAskInFlight();
      return;
    }

    const sourceMessage = activeAdapter
      .getAssistantMessages()
      .find((message) => message.messageKey === annotation.messageKey);

    if (!sourceMessage) {
      const record = await upsertAnnotation(
        {
          ...annotation,
          answerState: 'failed',
          answerError: 'Source message was not found.',
          updatedAt: Date.now(),
        },
        options.storageArea,
      );

      renderLatestConversationUi(record);
      clearAskInFlight();
      return;
    }

    const pending = {
      ...annotation,
      answerMarkdown: '',
      answerState: 'pending' as const,
      answerError: undefined,
      updatedAt: Date.now(),
    };
    const pendingRecord = await upsertAnnotation(pending, options.storageArea);
    const askController = new AbortController();

    activeAskController = askController;
    activeAskAnnotationId = annotation.id;
    renderLatestConversationUi(pendingRecord);

    try {
      const request = buildClarifyRequest({
        exact: annotation.quote.exact,
        context: activeAdapter.getContextForMessage(
          annotation.messageKey,
          DEFAULT_CONTEXT_BUDGET,
        ),
        question: annotation.question,
        conversationId,
        messageKey: annotation.messageKey,
        source: getClarifySource(locationRef, documentRef),
        model: getConfiguredModel(
          await getProviderSettings(options.storageArea),
        ),
      });
      const response = await requestClarification(
        request,
        options.sendMessage,
        {
          signal: askController.signal,
        },
      );
      const currentRecord = await getConversation(
        conversationId,
        options.storageArea,
      );
      const currentAnnotation = currentRecord?.annotations.find(
        (candidate) => candidate.id === annotation.id,
      );

      activeAskController = null;
      activeAskAnnotationId = null;
      clearAskInFlight();

      if (
        deletedAnnotationIds.has(annotation.id) ||
        currentAnnotation?.kind !== 'ask'
      ) {
        return;
      }

      renderLatestConversationUi(
        await upsertAnnotation(
          {
            ...currentAnnotation,
            answerMarkdown: response.answerMarkdown,
            answerState: 'complete',
            answerError: undefined,
            provider: toSafeProviderMetadata(response),
            updatedAt: Date.now(),
          },
          options.storageArea,
        ),
      );
    } catch (error) {
      activeAskController = null;
      activeAskAnnotationId = null;
      clearAskInFlight();
      reportProviderFailure('clarify-request', getSafeErrorLabel(error));

      if (deletedAnnotationIds.has(annotation.id)) {
        return;
      }

      renderLatestConversationUi(
        await upsertAnnotation(
          {
            ...pending,
            answerState: 'failed',
            answerError: getSafeErrorLabel(error),
            updatedAt: Date.now(),
          },
          options.storageArea,
        ),
      );
    }
  }

  function renderLatestConversationUi(record: ConversationRecord | null): void {
    conversationUiRevision += 1;

    if (record && record.conversationId !== activeConversationId) {
      void refreshConversationUi();
      return;
    }

    renderConversationUi(record);
  }

  function renderConversationUi(record: ConversationRecord | null): void {
    mutationObserver?.disconnect();

    const results = highlightRenderer.paint(record?.annotations ?? []);
    const orphanedAnnotationIds = new Set(
      results
        .filter((result) => result.orphaned)
        .map((result) => result.annotation.id),
    );

    updateOrphanStatus(orphanedAnnotationIds.size, shadowRoot);
    if (orphanedAnnotationIds.size > 0) {
      reportBreakage(
        'highlight-repaint',
        `${String(orphanedAnnotationIds.size)} annotations could not be re-located.`,
      );
    }
    notesPanel.render(record, orphanedAnnotationIds);
    askBubbles.render(record?.annotations ?? [], orphanedAnnotationIds);
    pinControls.render(activeAdapter.getAssistantMessages());
    mutationObserver?.observe(documentRef.body, {
      childList: true,
      subtree: true,
    });
  }

  function navigateToAnnotation(annotation: StoredAnnotation): void {
    const highlightedElement = findHighlightElement(annotation.id, documentRef);

    if (highlightedElement) {
      scrollToSource(highlightedElement);
      flashSource(highlightedElement);
      return;
    }

    const message = activeAdapter
      .getAssistantMessages()
      .find((candidate) => candidate.messageKey === annotation.messageKey);

    if (!message) {
      return;
    }

    const resolved = resolveTextAnchor(
      message.element,
      annotation.quote,
      annotation.position,
    );

    if (resolved) {
      const sourceElement =
        resolved.range.startContainer.parentElement ?? message.element;

      scrollToSource(sourceElement);
      flashSource(sourceElement);
      return;
    }

    scrollToSource(message.element);
  }

  function navigateToMessage(messageKey: string): void {
    const message = activeAdapter
      .getAssistantMessages()
      .find((candidate) => candidate.messageKey === messageKey);

    if (message) {
      scrollToSource(message.element);
      flashSource(message.element);
    }
  }

  function getStableConversationId(): string {
    return activeAdapter.getConversationId() ?? 'chatgpt-temp-conversation';
  }

  async function ensurePrivacyDisclosureAccepted(
    settings: ProviderSettings,
  ): Promise<boolean> {
    if (settings.privacyDisclosureAcceptedAt) {
      return true;
    }

    const accepted = await providerSettings.showPrivacyDisclosure();

    if (!accepted) {
      return false;
    }

    await updateProviderSettings(
      {
        ...settings,
        privacyDisclosureAcceptedAt: Date.now(),
      },
      options.storageArea,
    );
    await providerSettings.refresh();
    return true;
  }

  async function refreshProviderStatus(): Promise<ProviderStatusViewModel | null> {
    try {
      const status = await requestProviderStatus(options.sendMessage);

      if (!status.ok) {
        reportProviderFailure(
          'health-check',
          status.failures[0] ?? status.label,
        );
      }

      return status;
    } catch {
      const settings = await getProviderSettings(options.storageArea);

      reportProviderFailure('health-check', 'Provider status unavailable.');

      return {
        ok: false,
        label: 'Provider status unavailable.',
        failures: ['Provider status unavailable.'],
        settings,
      };
    }
  }

  async function syncProviderStatus(): Promise<ProviderStatusViewModel | null> {
    const status = await refreshProviderStatus();

    setProviderHealth(status);
    return status;
  }
}

const PROVIDER_DEGRADED_BANNER_ID = 'sidenote-provider-degraded-banner';
const PROVIDER_DEGRADED_MESSAGE =
  'Ask is paused: the configured AI provider is unavailable. Your highlights and notes are safe.';

function updateProviderDegradedBanner(
  status: ProviderHealthState | null,
  shadowRoot: ShadowRoot,
): void {
  let banner = shadowRoot.querySelector<HTMLDivElement>(
    `#${PROVIDER_DEGRADED_BANNER_ID}`,
  );

  if (!banner) {
    banner = shadowRoot.ownerDocument.createElement('div');
    banner.id = PROVIDER_DEGRADED_BANNER_ID;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    shadowRoot.append(banner);
  }

  banner.hidden = status?.ok !== false;
  banner.textContent =
    status?.ok === false
      ? `${PROVIDER_DEGRADED_MESSAGE} ${status.label}`.trim()
      : '';
}

function createAnnotationId(): string {
  return crypto.randomUUID();
}

function getPinLabel(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}

function findHighlightElement(
  annotationId: string,
  documentRef: Document,
): HTMLElement | null {
  return (
    Array.from(
      documentRef.querySelectorAll<HTMLElement>('[data-sidenote-highlight-id]'),
    ).find((element) => element.dataset.sidenoteHighlightId === annotationId) ??
    null
  );
}

function scrollToSource(element: Element | null): void {
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function flashSource(element: HTMLElement): void {
  const previousOutline = element.style.outline;
  const previousOutlineOffset = element.style.outlineOffset;

  element.dataset.sidenoteFlash = 'true';
  element.style.outline = '2px solid #2563eb';
  element.style.outlineOffset = '3px';
  window.setTimeout(() => {
    delete element.dataset.sidenoteFlash;
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOutlineOffset;
  }, 900);
}

function updateOrphanStatus(count: number, shadowRoot: ShadowRoot): void {
  let status = shadowRoot.querySelector<HTMLDivElement>(
    '#sidenote-orphan-status',
  );

  if (!status) {
    status = shadowRoot.ownerDocument.createElement('div');
    status.id = 'sidenote-orphan-status';
    status.setAttribute('role', 'status');
    shadowRoot.append(status);
  }

  status.hidden = count === 0;
  status.textContent =
    count === 1
      ? "1 highlight couldn't be re-located."
      : `${String(count)} highlights couldn't be re-located.`;
}

const ROUTE_WATCHER_KEY = Symbol.for('sidenote.route-watchers');

interface RouteWatcherWindow extends Window {
  [ROUTE_WATCHER_KEY]?: {
    callbacks: Set<() => void>;
  };
}

function installRouteChangeWatcher(
  windowRef: Window,
  callback: () => void,
): void {
  const routeWindow = windowRef as RouteWatcherWindow;
  const existingWatcher = routeWindow[ROUTE_WATCHER_KEY];

  if (existingWatcher) {
    existingWatcher.callbacks.add(callback);
    return;
  }

  const callbacks = new Set<() => void>([callback]);
  const notify = (): void => {
    windowRef.setTimeout(() => {
      for (const listener of callbacks) {
        listener();
      }
    }, 0);
  };
  const originalPushState = windowRef.history.pushState.bind(windowRef.history);
  const originalReplaceState = windowRef.history.replaceState.bind(
    windowRef.history,
  );

  routeWindow[ROUTE_WATCHER_KEY] = { callbacks };

  try {
    windowRef.history.pushState = function pushState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      originalPushState(data, unused, url);
      notify();
    };
    windowRef.history.replaceState = function replaceState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      originalReplaceState(data, unused, url);
      notify();
    };
  } catch {
    callbacks.delete(callback);
  }
}

function getClarifySource(
  locationRef: Location,
  documentRef: Document,
): {
  site: 'chatgpt';
  url: string;
  title?: string;
} {
  return {
    site: 'chatgpt',
    url: locationRef.href,
    title: documentRef.title || undefined,
  };
}

function getSafeErrorLabel(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Provider request was cancelled.';
  }

  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Provider request failed.';
}

function getHuggingFacePresetId(settings: ProviderSettings): string {
  return settings.huggingFacePresetId ?? 'huggingface-default';
}

function getConfiguredModel(settings: ProviderSettings): string {
  if (settings.activeProviderId === 'huggingface') {
    const presetId = getHuggingFacePresetId(settings);
    const preset = settings.byokPresets.find(
      (candidate) => candidate.id === presetId,
    );

    return preset?.model ?? settings.defaultModel;
  }

  return settings.defaultModel;
}

function toSafeProviderMetadata(
  response: ClarifyResponse,
): AskProviderMetadata {
  return {
    providerId: response.provider.id,
    model: sanitizeMetadataLabel(response.provider.model),
    endpointLabel: sanitizeMetadataLabel(response.provider.endpointLabel),
    usage: sanitizeUsage(response.usage),
  };
}

function sanitizeMetadataLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;

      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim();

  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    /\b(Bearer|Authorization)\b/iu.test(normalized) ||
    /\b(?:hf|sk)-?[A-Za-z0-9_]{16,}\b/u.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function sanitizeUsage(
  usage: ClarifyResponse['usage'],
): AskProviderMetadata['usage'] {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: sanitizeTokenCount(usage.inputTokens),
    outputTokens: sanitizeTokenCount(usage.outputTokens),
    totalTokens: sanitizeTokenCount(usage.totalTokens),
  };
}

function sanitizeTokenCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
