import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProperties,
  classifyCommitType,
  commitsFromEvent,
  syncCommit,
} from './notion-sync.mjs';

test('classifies conventional commits and migration files conservatively', () => {
  assert.equal(classifyCommitType('feat: add counting dates', []), 'Feature');
  assert.equal(classifyCommitType('fix: correct duplicate EAN', []), 'Fix');
  assert.equal(classifyCommitType('security: restrict company access', []), 'Segurança');
  assert.equal(
    classifyCommitType('adjust company onboarding', ['supabase/migrations/021.sql']),
    'Migration',
  );
  assert.equal(classifyCommitType('update project metadata', ['README.md']), 'Release');
});

test('normalizes every pushed commit and removes duplicate SHAs', () => {
  const event = {
    repository: { html_url: 'https://github.com/siinzato/InventoryBlind' },
    commits: [
      { id: 'abc123', message: 'feat: first', timestamp: '2026-08-21T10:00:00Z' },
      { id: 'abc123', message: 'feat: duplicate', timestamp: '2026-08-21T10:00:00Z' },
      { id: 'def456', message: 'fix: second', timestamp: '2026-08-21T11:00:00Z' },
    ],
  };

  assert.deepEqual(commitsFromEvent(event), [
    {
      sha: 'abc123',
      message: 'feat: first',
      timestamp: '2026-08-21T10:00:00Z',
      url: 'https://github.com/siinzato/InventoryBlind/commit/abc123',
    },
    {
      sha: 'def456',
      message: 'fix: second',
      timestamp: '2026-08-21T11:00:00Z',
      url: 'https://github.com/siinzato/InventoryBlind/commit/def456',
    },
  ]);
});

test('uses the workflow SHA when a manual event has no commit list', () => {
  const fallback = {
    sha: 'fff999',
    message: 'Manual synchronization of fff999',
    timestamp: '2026-08-21T12:00:00Z',
    url: 'https://github.com/siinzato/InventoryBlind/commit/fff999',
  };

  assert.deepEqual(
    commitsFromEvent(
      { repository: { html_url: 'https://github.com/siinzato/InventoryBlind' } },
      fallback,
    ),
    [fallback],
  );
});

test('builds a published but unvalidated Notion record', () => {
  const properties = buildProperties({
    sha: 'abc123',
    message: 'feat: add counting dates\n\nStores start and finish.',
    timestamp: '2026-08-21T10:00:00Z',
    url: 'https://github.com/siinzato/InventoryBlind/commit/abc123',
    files: ['src/components/Counting.tsx'],
  });

  assert.equal(properties['Atualização'].title[0].text.content, 'feat: add counting dates');
  assert.equal(properties.Estado.select.name, 'Publicado');
  assert.equal(properties.Tipo.select.name, 'Feature');
  assert.equal(properties.SHA.rich_text[0].text.content, 'abc123');
  assert.equal(properties.Validado.checkbox, false);
  assert.equal(properties.Arquivos.rich_text[0].text.content, 'src/components/Counting.tsx');
});

test('updates an existing Notion page found by SHA', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/query')) {
      return response({ results: [{ id: 'page-1' }] });
    }
    return response({ id: 'page-1' });
  };

  const action = await syncCommit({
    commit: commitFixture(),
    dataSourceId: 'data-source-1',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(action, 'updated');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /data_sources\/data-source-1\/query$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[1].url, /pages\/page-1$/);
  assert.equal(calls[1].options.method, 'PATCH');
});

test('creates a Notion page when the SHA is not recorded', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/query') ? response({ results: [] }) : response({ id: 'page-2' });
  };

  const action = await syncCommit({
    commit: commitFixture(),
    dataSourceId: 'data-source-1',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(action, 'created');
  assert.match(calls[1].url, /pages$/);
  assert.equal(calls[1].options.method, 'POST');
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: 'data-source-1' });
});

function commitFixture() {
  return {
    sha: 'abc123',
    message: 'fix: correct count',
    timestamp: '2026-08-21T10:00:00Z',
    url: 'https://github.com/siinzato/InventoryBlind/commit/abc123',
    files: ['src/lib/count.ts'],
  };
}

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
