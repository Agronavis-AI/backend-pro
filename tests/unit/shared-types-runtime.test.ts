// A module, not a script — see the note in rate-limit.test.ts.
export {};

import fs from 'fs';
import path from 'path';

/**
 * `src/types` stays types-only.
 *
 * It is TypeScript source reached through a tsconfig path, not a built
 * package, so the compiler resolves it and Node never does. Import a type and
 * it vanishes at compile time; import a value and `dist/server.js` tries to
 * require a path that does not exist at runtime — the build passes and the
 * service will not boot.
 */

const SRC = path.join(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'types' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const offenders = sourceFiles(SRC).flatMap((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from '@agronavis\/shared-types';/gm)]
    .map(() => path.relative(SRC, file));
});

describe('the type contract', () => {
  it('is only ever imported as types', () => {
    expect(offenders).toEqual([]);
  });

  it('resolves through tsconfig, not node_modules', () => {
    const tsconfig = fs.readFileSync(path.join(__dirname, '../../tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('./src/types/index.ts');

    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    // A dependency entry would mean something expects it at runtime.
    expect(pkg.dependencies['@agronavis/shared-types']).toBeUndefined();
  });
});
