import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

interface TsConfigJson {
  compilerOptions?: {
    strict?: boolean;
  };
}

function readPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(resolve('package.json'), 'utf8'),
  ) as PackageJson;
}

function readTsConfig(): TsConfigJson {
  return JSON.parse(
    readFileSync(resolve('tsconfig.json'), 'utf8'),
  ) as TsConfigJson;
}

describe('Phase 0 project configuration', () => {
  it('enables strict TypeScript and defines the required verification scripts', () => {
    const packageJson = readPackageJson();
    const tsConfig = readTsConfig();

    expect(tsConfig.compilerOptions?.strict).toBe(true);
    expect(packageJson.scripts).toMatchObject({
      lint: 'wxt prepare && eslint .',
      typecheck: 'wxt prepare && tsc --noEmit',
      test: 'vitest run',
      build: 'wxt build',
      'test:e2e': 'npm run build && playwright test',
      verify:
        'npm run lint && npm run typecheck && npm run test && npm run build',
      'verify:phase0': 'npm run verify && npm run test:e2e',
    });
  });

  it('defines CI gates for lint, typecheck, tests, and build', () => {
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('run: npm run lint');
    expect(workflow).toContain('run: npm run typecheck');
    expect(workflow).toContain('run: npm run test');
    expect(workflow).toContain('run: npm run build');
  });
});
