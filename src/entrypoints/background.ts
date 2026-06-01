import {
  handleProviderSettingsRuntimeMessage,
  handleRuntimeMessage,
} from '../background/provider-routing';
import {
  isClarifyCancelRuntimeMessage,
  isClarifyRuntimeMessage,
  isProviderOptionsOpenRuntimeMessage,
  isProviderSecretRemoveRuntimeMessage,
  isProviderSecretSaveRuntimeMessage,
  isProviderStatusRuntimeMessage,
  type RuntimeMessageResponse,
} from '../shared/messaging';

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: RuntimeMessageResponse) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
};

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      !isClarifyRuntimeMessage(message) &&
      !isClarifyCancelRuntimeMessage(message) &&
      !isProviderStatusRuntimeMessage(message) &&
      !isProviderSecretSaveRuntimeMessage(message) &&
      !isProviderSecretRemoveRuntimeMessage(message) &&
      !isProviderOptionsOpenRuntimeMessage(message)
    ) {
      return false;
    }

    const responsePromise = isClarifyRuntimeMessage(message)
      ? handleRuntimeMessage(message)
      : isClarifyCancelRuntimeMessage(message)
        ? handleRuntimeMessage(message)
        : handleProviderSettingsRuntimeMessage(message);

    responsePromise
      .then((response) => {
        if (response) {
          sendResponse(response);
        }
      })
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  });

  console.info('Sidenote background service worker ready.');
});
