import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const extensionPath = path.resolve('.output/chrome-mv3');

interface ChromeManifest {
  manifest_version: number;
  name: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: {
    matches?: string[];
  }[];
}

test('Phase 0 generated manifest uses minimal ChatGPT permissions', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'),
  ) as ChromeManifest;

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe('Sidenote');
  expect(manifest.permissions).toEqual(['storage']);
  expect(manifest.host_permissions).toEqual([
    'https://chatgpt.com/*',
    'https://api.sidenote.app/*',
    'https://router.huggingface.co/*',
  ]);
  expect(manifest.content_scripts?.[0]?.matches).toEqual([
    'https://chatgpt.com/*',
  ]);
});

test('Phase 0 extension loads on ChatGPT and renders the debug dot', async ({
  browserName,
  playwright,
}) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium.');

  const context = await playwright.chromium.launchPersistentContext('', {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    // Chromium extensions do not load reliably in Playwright's headless mode.
    headless: false,
  });

  try {
    const page = await context.newPage();
    const sidenoteErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /sidenote/i.test(message.text())) {
        sidenoteErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      if (/sidenote/i.test(error.message)) {
        sidenoteErrors.push(error.message);
      }
    });

    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#sidenote-overlay-root')).toHaveCount(1);

    const dotVisible = await page
      .locator('#sidenote-overlay-root')
      .evaluate((host) => {
        const dot = host.shadowRoot?.querySelector('#sidenote-debug-dot');
        if (!dot) {
          return false;
        }

        const styles = window.getComputedStyle(dot);
        return (
          styles.position === 'fixed' &&
          styles.backgroundColor === 'rgb(22, 163, 74)'
        );
      });

    expect(dotVisible).toBe(true);
    expect(sidenoteErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
