import { bootstrapContentScript } from '../content';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  main() {
    bootstrapContentScript();
  },
});
