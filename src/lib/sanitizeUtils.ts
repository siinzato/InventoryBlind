const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

export function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"'/]/g, (ch) => HTML_ENTITIES[ch]);
}

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const SCRIPT_TAG    = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const ON_HANDLER    = /\bon\w+\s*=/gi;
const JAVASCRIPT    = /javascript\s*:/gi;

export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value)
    .replace(CONTROL_CHARS, '')
    .replace(SCRIPT_TAG, '')
    .replace(ON_HANDLER, '')
    .replace(JAVASCRIPT, '')
    .trim();
  return str.slice(0, 2000);
}

export function sanitizeProductField(value: unknown): string {
  return sanitizeText(value);
}

export function sanitizeRecord(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = sanitizeText(value);
  }
  return out;
}
