import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Sidenote',
    description: 'Highlight-to-clarify side notes for ChatGPT.',
    version: '0.0.0',
    permissions: ['storage'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://api.sidenote.app/*',
      'https://router.huggingface.co/*',
    ],
    action: {
      default_title: 'Sidenote',
    },
  },
});
