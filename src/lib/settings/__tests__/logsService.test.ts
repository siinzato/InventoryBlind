import { describe, expect, it } from 'vitest';
import { classifyLogOutcome, redactMetadata, logsToCsv, startOfLocalDay, endOfLocalDay } from '../logsService';
import type { AuditLog } from '../../auditLogService';

describe('classifyLogOutcome', () => {
  it('classifica access.denied como negado', () => {
    expect(classifyLogOutcome('access.denied')).toBe('denied');
  });

  it('classifica ações normais como sucesso', () => {
    expect(classifyLogOutcome('physical_count.finalized')).toBe('success');
    expect(classifyLogOutcome('apikey.created')).toBe('success');
  });

  it('reconhece variações de recusa (failed/rejected/blocked) sem depender de um caso específico', () => {
    expect(classifyLogOutcome('erp.sync_failed')).toBe('denied');
    expect(classifyLogOutcome('webhook.rejected')).toBe('denied');
  });
});

describe('redactMetadata', () => {
  it('nunca mostra o valor de uma chave que pareça segredo', () => {
    const redacted = redactMetadata({ token: 'abc123', api_key: 'xyz', senha: '123', normal_field: 'ok' });
    expect(redacted.token).toBe('••••••••');
    expect(redacted.api_key).toBe('••••••••');
    expect(redacted.senha).toBe('••••••••');
    expect(redacted.normal_field).toBe('ok');
  });

  it('não quebra com metadata vazio ou undefined-like', () => {
    expect(redactMetadata({})).toEqual({});
  });
});

describe('logsToCsv', () => {
  const rows: AuditLog[] = [
    {
      id: '1', company_id: 'c1', user_id: 'u1', user_email: 'a@b.com',
      action: 'physical_count.finalized', resource_type: 'session', resource_id: 's1',
      description: 'Sessão finalizada', ip_address: null, user_agent: null, metadata: {},
      created_at: '2026-08-20T10:00:00.000Z',
    },
  ];

  it('gera cabeçalho e uma linha por registro', () => {
    const csv = logsToCsv(rows);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Resultado');
    expect(lines[1]).toContain('physical_count.finalized');
    expect(lines[1]).toContain('Sucesso');
  });

  it('escapa vírgulas e aspas no campo de descrição', () => {
    const withComma: AuditLog = { ...rows[0], description: 'Nota, com vírgula e "aspas"' };
    const csv = logsToCsv([withComma]);
    expect(csv).toContain('"Nota, com vírgula e ""aspas"""');
  });
});

describe('limites de data', () => {
  it('o fim do dia é o último instante daquele dia no fuso local, não em UTC', () => {
    const end = new Date(endOfLocalDay('2026-08-21'));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(7); // agosto
    expect(end.getDate()).toBe(21);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('o início do dia é a meia-noite local daquele dia', () => {
    const start = new Date(startOfLocalDay('2026-08-21'));
    expect(start.getDate()).toBe(21);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });
});
