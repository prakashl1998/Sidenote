import {
  getProviderSecret,
  getProviderSettings,
  type ChromeStorageAreaLike,
} from '../storage';
import { HuggingFaceProvider } from './huggingface';
import { SidenoteApiProvider } from './sidenote-api';
import type { ClarificationProvider } from './types';

export async function getActiveClarificationProvider(
  storageArea?: ChromeStorageAreaLike,
): Promise<ClarificationProvider> {
  const settings = await getProviderSettings(storageArea);

  if (settings.activeProviderId === 'huggingface') {
    const presetId = settings.huggingFacePresetId;
    const preset = settings.byokPresets.find(
      (candidate) => candidate.id === presetId,
    );

    return new HuggingFaceProvider({
      baseUrl: settings.huggingFaceRouterBaseUrl,
      model: preset?.model ?? settings.defaultModel,
      presetId,
      getToken: (tokenPresetId) =>
        getProviderSecret(tokenPresetId, storageArea),
    });
  }

  if (settings.activeProviderId === 'sidenote-api') {
    return new SidenoteApiProvider(settings.sidenoteApiBaseUrl);
  }

  throw new Error('OpenAI-compatible provider preset is not available in v1.');
}
