// A rotina de lembrete vive no banco e a marca da sessão vive no TypeScript. Nada no
// compilador liga os dois: se o formato do rótulo do dia mudar de um lado só, a rotina
// deixa de enxergar a contagem de hoje e passa a avisar todo dia que o lote não saiu —
// sem erro, sem log, sem ninguém perceber até a equipe parar de ler o sino.
//
// Estes testes são o que trava esse contrato. Mesmo mecanismo de
// brandLogoIntegration.test.ts: lê o SQL cru e compara com o que o módulo produz.
//
// Asserções sempre em pedaço de UMA linha: o arquivo pode estar com CRLF no disco, e
// trecho de várias linhas deixaria de casar por causa do \r.

import { describe, expect, it } from 'vitest';
import { CYCLE_SESSION_MARKER, cycleSessionDayLabel } from '../cycleProgramDomain';
import { canWrite } from '../../permissionService';
import type { Role } from '../../permissionService';

// Curinga no timestamp: o Supabase versiona pelo timestamp do nome, e ele muda quando a
// migration é aplicada pelo servidor. O que identifica a migration é o `123_...`.
const RAW = import.meta.glob('/supabase/migrations/*_123_cycle_program_reminders.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const MIGRATION = Object.values(RAW)[0] ?? '';

const TODOS_OS_PAPEIS: Role[] = ['owner', 'admin', 'manager', 'lead', 'counter', 'viewer'];

describe('contrato entre a marca da sessão e a rotina do banco', () => {
  it('a migration foi encontrada', () => {
    expect(MIGRATION.length).toBeGreaterThan(0);
  });

  it('a rotina procura a sessão pela mesma marca que o módulo grava', () => {
    expect(CYCLE_SESSION_MARKER).toBe('Ciclagem');
    expect(MIGRATION).toContain("s.street_from = 'Ciclagem'");
  });

  it('o rótulo do dia tem o mesmo formato dos dois lados', () => {
    // 3 de novembro de 2026, hora local — o mesmo dia que a máscara abaixo produziria.
    expect(cycleSessionDayLabel(new Date(2026, 10, 3, 9, 30))).toBe('03/11/2026');
    expect(MIGRATION).toContain("to_char(v_hoje, 'DD/MM/YYYY')");
  });
});

describe('a rotina lembra, não decide', () => {
  // A regra do lote vive no TypeScript. Uma segunda implementação em SQL divergiria em
  // silêncio: a tela mostraria um lote e a rotina criaria outro.
  it('não cria contagem nem lê catálogo', () => {
    expect(MIGRATION).not.toMatch(/INSERT INTO physical_count_sessions/i);
    expect(MIGRATION).not.toMatch(/pc_create_session/i);
    expect(MIGRATION).not.toMatch(/FROM products\b/i);
    expect(MIGRATION).not.toMatch(/product_abc_xyz_classifications/i);
  });

  it('é aditiva: não apaga nem derruba nada', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe('quem recebe o aviso', () => {
  // A lista no SQL é a mesma que tem inventory.write na aplicação: quem pode gerar ou
  // executar a contagem. Avisar quem não pode agir é o começo do sino ignorado.
  it('o SQL avisa exatamente quem a aplicação deixa contar', () => {
    const naRotina = (papel: Role) => MIGRATION.includes(`'${papel}'`);
    for (const papel of TODOS_OS_PAPEIS) {
      expect(naRotina(papel), papel).toBe(canWrite(papel));
    }
  });
});

describe('o lembrete nasce desligado e não dispara em vão', () => {
  it('as colunas novas nascem com o agendamento desligado', () => {
    expect(MIGRATION).toContain('schedule_enabled boolean NOT NULL DEFAULT false');
  });

  it('a rotina só roda para empresa com programa E lembrete ligados', () => {
    expect(MIGRATION).toContain('WHERE enabled AND schedule_enabled');
  });

  // `>=` e não `=`: uma passagem atrasada do agendador ainda entrega o aviso do dia.
  // A unicidade por (user_id, reference_date) é o que impede entregar duas vezes.
  it('atraso do agendador não engole o aviso, e não duplica', () => {
    expect(MIGRATION).toContain('< v_empresa.schedule_hour');
    expect(MIGRATION).toContain('UNIQUE (user_id, reference_date)');
    expect(MIGRATION).toContain('ON CONFLICT ON CONSTRAINT cycle_program_notifications_one_per_day DO NOTHING');
  });

  it('o cliente não escreve no canal: só policy de SELECT', () => {
    expect(MIGRATION).toContain('cycle_program_notifications_select');
    expect(MIGRATION).not.toMatch(/cycle_program_notifications_insert/);
    expect(MIGRATION).not.toMatch(/cycle_program_notifications_update/);
  });
});
