import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';
const MAX_TEXT_LENGTH = 1900;

export function classifyCommitType(message, files = []) {
  const subject = message.trim().toLowerCase();
  if (/^(security|sec)(\(.+\))?:/.test(subject)) return 'Segurança';
  if (/^fix(\(.+\))?:/.test(subject)) return 'Fix';
  if (/^feat(\(.+\))?:/.test(subject)) return 'Feature';
  if (/^release(\(.+\))?:/.test(subject)) return 'Release';
  if (/^migration(\(.+\))?:/.test(subject)) return 'Migration';
  if (files.some((file) => file.startsWith('supabase/migrations/'))) return 'Migration';
  return 'Release';
}

export function commitsFromEvent(event, fallbackCommit = null) {
  const repositoryUrl = event.repository?.html_url?.replace(/\/$/, '');
  const candidates = event.commits?.length
    ? event.commits
    : event.head_commit
      ? [event.head_commit]
      : event.after
        ? [{ id: event.after, message: 'Manual synchronization', timestamp: new Date().toISOString() }]
        : fallbackCommit
          ? [fallbackCommit]
          : [];

  const seen = new Set();
  return candidates.flatMap((item) => {
    const sha = item.id || item.sha;
    if (!sha || seen.has(sha)) return [];
    seen.add(sha);
    return [{
      sha,
      message: item.message || 'Commit without message',
      timestamp: item.timestamp || new Date().toISOString(),
      url: item.url || (repositoryUrl ? `${repositoryUrl}/commit/${sha}` : null),
    }];
  });
}

export function buildProperties(commit) {
  const message = commit.message?.trim() || 'Commit without message';
  const title = message.split(/\r?\n/, 1)[0].slice(0, MAX_TEXT_LENGTH);
  const summary = message.replace(/\s+/g, ' ').slice(0, MAX_TEXT_LENGTH);
  const files = (commit.files || []).join('\n').slice(0, MAX_TEXT_LENGTH);

  return {
    'Atualização': titleProperty(title),
    'Estado': { select: { name: 'Publicado' } },
    'Tipo': { select: { name: classifyCommitType(message, commit.files) } },
    'SHA': richTextProperty(commit.sha),
    'Resumo': richTextProperty(summary),
    'Arquivos': richTextProperty(files),
    'Link': { url: commit.url || null },
    'Data': { date: { start: commit.timestamp } },
    'Validado': { checkbox: false },
  };
}

export async function syncCommit({ commit, dataSourceId, token, fetchImpl = fetch }) {
  const existing = await notionRequest({
    path: `/data_sources/${dataSourceId}/query`,
    method: 'POST',
    token,
    fetchImpl,
    body: {
      filter: { property: 'SHA', rich_text: { equals: commit.sha } },
      page_size: 1,
    },
  });

  const properties = buildProperties(commit);
  if (existing.results?.[0]?.id) {
    await notionRequest({
      path: `/pages/${existing.results[0].id}`,
      method: 'PATCH',
      token,
      fetchImpl,
      body: { properties },
    });
    return 'updated';
  }

  await notionRequest({
    path: '/pages',
    method: 'POST',
    token,
    fetchImpl,
    body: {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
    },
  });
  return 'created';
}

export function changedFilesForCommit(sha) {
  return execFileSync(
    'git',
    ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha],
    { encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

async function notionRequest({ path, method, token, body, fetchImpl }) {
  const response = await fetchImpl(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Notion API ${response.status}: ${details}`);
  }
  return response.json();
}

function richTextProperty(content) {
  return content
    ? { rich_text: [{ type: 'text', text: { content } }] }
    : { rich_text: [] };
}

function titleProperty(content) {
  return { title: [{ type: 'text', text: { content } }] };
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_UPDATES_DATA_SOURCE_ID;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!token) throw new Error('Missing NOTION_TOKEN repository secret.');
  if (!dataSourceId) throw new Error('Missing NOTION_UPDATES_DATA_SOURCE_ID.');
  if (!eventPath) throw new Error('Missing GITHUB_EVENT_PATH.');

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const fallbackSha = process.env.GITHUB_SHA;
  const repositoryUrl = event.repository?.html_url?.replace(/\/$/, '');
  const commits = commitsFromEvent(event, fallbackSha ? {
    sha: fallbackSha,
    message: `Manual synchronization of ${fallbackSha.slice(0, 7)}`,
    timestamp: new Date().toISOString(),
    url: repositoryUrl ? `${repositoryUrl}/commit/${fallbackSha}` : null,
  } : null);
  if (!commits.length) {
    console.log('No commits found in the GitHub event.');
    return;
  }

  for (const commit of commits) {
    commit.files = changedFilesForCommit(commit.sha);
    const action = await syncCommit({ commit, dataSourceId, token });
    console.log(`${action}: ${commit.sha} (${commit.files.length} files)`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
