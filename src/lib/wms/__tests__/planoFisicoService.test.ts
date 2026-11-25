// A leitura das medidas da planta, e o contrato com a migration 133.
//
// Dois riscos de verdade aqui, e nenhum dos dois aparece olhando a cena:
//
//  1. `numeric` do Postgres chega como STRING. Uma medida em texto não quebra o 3D — ela
//     desenha errado, calada. Se `z_inicio` virasse `'18.6'`, o galpão novo nasceria a
//     dezoito mil metros do prédio atual na primeira soma.
//  2. O fallback precisa desenhar EXATAMENTE o que a constante desenhava. Fallback que
//     desenha outra coisa não é fallback, é um segundo layout escondido atrás de um erro
//     de rede.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
// `select` devolve `eq` E `order`: as duas consultas do módulo têm cadeias diferentes —
// `carregarPlantaFisica` filtra por andar, `listarPavimentos` lê todos e só ordena.
const select = vi.fn(() => ({ eq, order }));
const from = vi.fn(() => ({ select }));
vi.mock('../../supabase', () => ({ supabase: { from } }));

import { AZ2027_TERREO } from '../warehouse3dPlantaFisica';

const LINHA_GALPAO_NOVO = {
  nome: 'Galpão novo',
  // Como o PostgREST entrega de verdade: numeric em texto.
  z_inicio: '18.6',
  comprimento: '26.6',
  fileiras: 4,
  comprimento_da_fileira: '15.0',
  corredor_inicio: '2.2',
  distribuicao: 'dupla-central',
  corredor_longitudinal: '2.65',
  rotulos: ['E', 'F', 'G', 'H'],
};

describe('carregarPlantaFisica', () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    order.mockReset();
    vi.restoreAllMocks();
  });

  it('converte numeric em texto para número — senão a medida entra como string na conta', async () => {
    order.mockResolvedValueOnce({ data: [LINHA_GALPAO_NOVO], error: null });
    const { carregarPlantaFisica } = await import('../planoFisicoService');

    const { trechos, origem } = await carregarPlantaFisica(1);

    expect(origem).toBe('banco');
    expect(trechos).toHaveLength(1);
    const t = trechos[0];
    expect(t.zInicio).toBe(18.6);
    expect(t.comprimento).toBe(26.6);
    expect(t.comprimentoDaFileira).toBe(15);
    expect(t.corredorInicio).toBe(2.2);
    expect(t.corredorLongitudinal).toBe(2.65);
    // Não basta valer 18.6 na comparação frouxa: `'18.6' == 18.6` passaria e a soma não.
    for (const v of [t.zInicio, t.comprimento, t.comprimentoDaFileira, t.corredorLongitudinal]) {
      expect(typeof v).toBe('number');
    }
    expect(t.zInicio + t.comprimento).toBe(45.2);
  });

  it('pede o pavimento certo e ordena por z_inicio — fora de ordem, a expedição cai no meio', async () => {
    order.mockResolvedValueOnce({ data: [LINHA_GALPAO_NOVO], error: null });
    const { carregarPlantaFisica } = await import('../planoFisicoService');

    await carregarPlantaFisica(2);

    expect(from).toHaveBeenCalledWith('warehouse_plan_sections');
    expect(eq).toHaveBeenCalledWith('andar', 2);
    expect(order).toHaveBeenCalledWith('z_inicio');
  });

  it('sem trecho cadastrado, cai na constante em vez de devolver galpão vazio', async () => {
    order.mockResolvedValueOnce({ data: [], error: null });
    const { carregarPlantaFisica } = await import('../planoFisicoService');

    const { trechos, origem, rotulos } = await carregarPlantaFisica(1);

    expect(origem).toBe('constante');
    expect(trechos).toEqual(AZ2027_TERREO);
    expect(rotulos['Galpão novo']).toEqual(['E', 'F', 'G', 'H']);
  });

  it('erro de leitura cai na constante e não estoura — mapa sem planta é tela vazia', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    order.mockResolvedValueOnce({ data: null, error: { message: 'rede' } });
    const { carregarPlantaFisica } = await import('../planoFisicoService');

    const { trechos, origem } = await carregarPlantaFisica(1);

    expect(origem).toBe('constante');
    expect(trechos).toEqual(AZ2027_TERREO);
  });

  it('rótulo nulo vira lista vazia, e não herda a letra do padrão', async () => {
    order.mockResolvedValueOnce({
      data: [{ ...LINHA_GALPAO_NOVO, rotulos: null }],
      error: null,
    });
    const { carregarPlantaFisica } = await import('../planoFisicoService');

    const { rotulos } = await carregarPlantaFisica(1);

    // Herdar faria a fileira montar `PP-E01-N1` para uma rua que não existe no cadastro.
    expect(rotulos['Galpão novo']).toEqual([]);
  });
});

// ── O contrato com a migration 133 ───────────────────────────────────────────────────
//
// O seed da 133 é cópia literal de AZ2027_TERREO, e tem que continuar sendo: se um lado
// mudar sozinho, o mapa passa a desenhar uma coisa com banco e outra sem, e não há como
// saber qual dos dois está certo. Este bloco lê o SQL e confere número por número.

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const M133 = (
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('133_warehouse_plan_sections')) ?? ''] ?? ''
).replace(/\r\n/g, '\n');

describe('133 — a tabela das medidas', () => {
  it('existe e não está vazia', () => {
    expect(M133.length).toBeGreaterThan(0);
  });

  it('é aditiva: não apaga nem desabilita nada', () => {
    expect(M133).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M133).not.toMatch(/\bTRUNCATE\b/i);
    expect(M133).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(M133).not.toMatch(/ALTER TABLE(?!\s+public\.warehouse_plan_sections)/i);
  });

  it('liga RLS e cria as quatro políticas', () => {
    expect(M133).toMatch(/enable row level security/i);
    for (const cmd of ['select', 'insert', 'update', 'delete']) {
      expect(M133).toContain(`warehouse_plan_sections_${cmd}`);
    }
  });

  it('escrever é de owner/admin/manager, como em warehouse_cells', () => {
    const escritas = M133.match(/for (insert|update|delete)[\s\S]*?;/gi) ?? [];
    expect(escritas.length).toBeGreaterThanOrEqual(3);
    for (const bloco of escritas) {
      expect(bloco).toMatch(/get_my_role\(\) = any \(array\['owner', 'admin', 'manager'\]\)/);
    }
  });

  it('o seed repete EXATAMENTE a constante — divergir faria o desenho mudar no deploy', () => {
    for (const t of AZ2027_TERREO) {
      const linha = M133.split('\n').find(l => l.includes(`'${t.nome}'`) && l.includes('1,'));
      expect(linha, `trecho ${t.nome} ausente do seed`).toBeTruthy();

      // Os valores do trecho ficam na linha seguinte à do nome, no VALUES.
      const idx = M133.split('\n').findIndex(l => l === linha);
      const valores = M133.split('\n')[idx + 1];
      const numeros = (valores.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

      // z_inicio, comprimento, fileiras, comprimentoDaFileira, corredorInicio na ordem
      // do INSERT. Comparar por posição é o que pega troca de coluna.
      expect(numeros.slice(0, 5)).toEqual([
        t.zInicio, t.comprimento, t.fileiras, t.comprimentoDaFileira, t.corredorInicio,
      ]);
      expect(valores).toContain(`'${t.distribuicao}'`);
      expect(numeros[5]).toBe(t.corredorLongitudinal);
    }
  });

  it('o seed grava a empresa explícita: get_my_company_id() é nulo sem sessão', () => {
    expect(M133).toMatch(/insert into public\.warehouse_plan_sections/i);
    expect(M133).toContain("'00000000-0000-0000-0000-000000000001'");
    expect(M133).toMatch(/on conflict \(company_id, andar, nome\) do nothing/i);
  });

  it('trava o desenho impossível: comprimento zero e distribuição inventada', () => {
    expect(M133).toMatch(/check \(comprimento > 0\)/i);
    expect(M133).toMatch(/distribuicao in \('uniforme', 'dupla-central'\)/i);
  });
});

// ── Pavimento ────────────────────────────────────────────────────────────────────────
//
// O fallback para a constante vale SO no terreo, porque a constante e o retrato do
// terreo. Em qualquer outro andar ela desenharia o andar de baixo com o nome do de cima —
// sem erro nenhum, e ninguem descobriria olhando a tela.

describe('carregarPlantaFisica por pavimento', () => {
  beforeEach(() => {
    from.mockClear(); select.mockClear(); eq.mockClear(); order.mockReset();
    vi.restoreAllMocks();
  });

  it('terreo sem trecho cadastrado cai no retrato da constante', () => {
    order.mockResolvedValueOnce({ data: [], error: null });
    return import('../planoFisicoService').then(async ({ carregarPlantaFisica }) => {
      const r = await carregarPlantaFisica(1);
      expect(r.origem).toBe('constante');
      expect(r.trechos).toEqual(AZ2027_TERREO);
    });
  });

  it('OUTRO andar sem trecho NAO herda a planta do terreo', async () => {
    order.mockResolvedValueOnce({ data: [], error: null });
    const { carregarPlantaFisica } = await import('../planoFisicoService');
    const r = await carregarPlantaFisica(2);
    expect(r.origem).toBe('vazio');
    expect(r.trechos).toEqual([]);
    expect(r.rotulos).toEqual({});
  });

  it('erro de leitura em outro andar tambem devolve vazio, nao o terreo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    order.mockResolvedValueOnce({ data: null, error: { message: 'rede' } });
    const { carregarPlantaFisica } = await import('../planoFisicoService');
    const r = await carregarPlantaFisica(3);
    expect(r.origem).toBe('vazio');
  });

  it('andar com trecho cadastrado le do banco normalmente', async () => {
    order.mockResolvedValueOnce({ data: [LINHA_GALPAO_NOVO], error: null });
    const { carregarPlantaFisica } = await import('../planoFisicoService');
    const r = await carregarPlantaFisica(2);
    expect(r.origem).toBe('banco');
    expect(eq).toHaveBeenCalledWith('andar', 2);
  });
});

describe('listarPavimentos', () => {
  beforeEach(() => {
    from.mockClear(); select.mockClear(); eq.mockClear(); order.mockReset();
    vi.restoreAllMocks();
  });

  it('o terreo entra SEMPRE, mesmo sem linha no banco', async () => {
    order.mockResolvedValueOnce({ data: [], error: null });
    const { listarPavimentos } = await import('../planoFisicoService');
    // Um seletor sem o terreo esconderia o unico andar que o mapa sabe desenhar hoje.
    expect(await listarPavimentos()).toEqual([1]);
  });

  it('junta os andares do banco com o terreo, sem repetir e em ordem', async () => {
    order.mockResolvedValueOnce({ data: [{ andar: 2 }, { andar: 1 }, { andar: 2 }], error: null });
    const { listarPavimentos } = await import('../planoFisicoService');
    expect(await listarPavimentos()).toEqual([1, 2]);
  });

  it('erro de leitura devolve so o terreo em vez de estourar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    order.mockResolvedValueOnce({ data: null, error: { message: 'rede' } });
    const { listarPavimentos } = await import('../planoFisicoService');
    expect(await listarPavimentos()).toEqual([1]);
  });
});
