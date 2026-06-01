export interface TextQuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextPositionAnchor {
  start: number;
  end: number;
}

export type AnnotationKind = 'ask' | 'save';

export type ClarificationProviderId =
  | 'sidenote-api'
  | 'huggingface'
  | 'openai-compatible';

export interface AskProviderMetadata {
  providerId: ClarificationProviderId;
  model?: string;
  endpointLabel?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface StoredAnnotation {
  id: string;
  conversationId: string;
  messageKey: string;
  kind: AnnotationKind;
  quote: TextQuoteAnchor;
  position: TextPositionAnchor;
  color: string;
  question?: string;
  answerMarkdown?: string;
  answerState?: 'pending' | 'complete' | 'failed';
  answerError?: string;
  provider?: AskProviderMetadata;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PinnedResponse {
  id: string;
  conversationId: string;
  messageKey: string;
  excerptMarkdown: string;
  label?: string;
  createdAt: number;
}

export interface ConversationRecord {
  conversationId: string;
  title?: string;
  annotations: StoredAnnotation[];
  pins: PinnedResponse[];
  updatedAt: number;
}

export interface ProviderSettings {
  activeProviderId: ClarificationProviderId;
  sidenoteApiBaseUrl: string;
  huggingFaceRouterBaseUrl: string;
  huggingFacePresetId?: string;
  defaultModel: string;
  defaultExplainQuestion: string;
  notesPanelSide: 'left' | 'right';
  byokPresets: ProviderPreset[];
  privacyDisclosureAcceptedAt?: number;
}

export interface ProviderPreset {
  id: string;
  providerId: 'huggingface' | 'openai-compatible';
  label: string;
  baseUrl: string;
  model: string;
  apiKeyStorageKey: string;
  createdAt: number;
  updatedAt: number;
}
