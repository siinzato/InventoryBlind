import { describe, expect, it } from 'vitest';

// Fixture isolation, enforced rather than promised.
//
// The requirement is that no synthetic number can reach a real customer. The
// mechanism is that nothing outside a test imports the fixtures, so Vite — which
// bundles from the entry graph — has no path to them. That mechanism is only worth
// anything if it is checked: an import added in a hurry would otherwise turn the
// guarantee off silently and no other test would notice.
//
// ── Why import.meta.glob and not node:fs ────────────────────────────────────
// This project's tsconfig.app.json covers all of `src` with no @types/node, so a
// `node:fs` import here typechecks as an error even though it runs fine under
// vitest. Vite's glob reads the same files, is typed by vite/client, and has the
// added property of seeing exactly the module graph the bundler sees — which is
// the thing being asserted.

/** Every source file, as raw text. `eager` so this is a plain object rather than a
 *  map of loaders, and the test body stays synchronous. */
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.test\.tsx?$/.test(path);
}

function isFixtureFile(path: string): boolean {
  return path.includes('/__fixtures__/');
}

describe('fixture isolation', () => {
  const paths = Object.keys(SOURCES);

  it('finds the source tree', () => {
    // Guards the guard: a broken glob would make every assertion below pass by
    // examining nothing.
    expect(paths.length).toBeGreaterThan(50);
    expect(paths.some(isFixtureFile)).toBe(true);
  });

  it('is imported only by tests', () => {
    const offenders = paths.filter(
      path => !isTestFile(path) && !isFixtureFile(path) && SOURCES[path].includes('__fixtures__')
    );

    // Named so a failure says which file broke the isolation, not just that
    // something did.
    expect(offenders).toEqual([]);
  });

  it('does not reach the Supabase client', () => {
    // A fixture that could reach the real client could, in principle, write. They
    // are inert data by construction and this keeps them that way.
    for (const path of paths.filter(isFixtureFile)) {
      expect(SOURCES[path]).not.toMatch(/from ['"][^'"]*supabase['"]/);
      expect(SOURCES[path]).not.toMatch(/createClient/);
    }
  });

  it('keeps fixture data out of the engines', () => {
    // The engines must be pure functions of their arguments. A hardcoded sample
    // count inside one would be a number with no provenance — exactly what the
    // "never show a fake number" requirement forbids.
    const engines = paths.filter(p =>
      /\/intelligence\/(analyticsEngine|healthEngine|alertEngine)\.ts$/.test(p)
    );

    expect(engines).toHaveLength(3);

    for (const engine of engines) {
      expect(SOURCES[engine]).not.toContain('__fixtures__');
      // The memorable fixture counts. Their presence in an engine would mean a
      // scenario number had been baked into logic.
      for (const suspicious of ['8724', '8_724', '342', '154_320']) {
        expect(SOURCES[engine]).not.toContain(suspicious);
      }
    }
  });

  it('keeps fixture data out of the components', () => {
    // Same rule one layer up: a component holding a sample figure would render it
    // regardless of what the engines reported.
    const components = paths.filter(p => p.includes('/components/intelligence/'));
    expect(components.length).toBeGreaterThan(0);

    for (const component of components) {
      expect(SOURCES[component]).not.toContain('__fixtures__');
      for (const suspicious of ['8724', '8.724', '342 ']) {
        expect(SOURCES[component]).not.toContain(suspicious);
      }
    }
  });
});
