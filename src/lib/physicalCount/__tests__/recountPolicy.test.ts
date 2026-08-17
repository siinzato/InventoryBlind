import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOUNT_SETTINGS,
  MAX_COUNT_ROUNDS,
  decideRecount,
  describeDecision,
  formatMeasured,
  isPercentThreshold,
  measureDivergence,
  measuredValueFor,
  usedPhysicalBase,
  type MeasurableItem,
  type RecountSettings,
  type RecountThresholdType,
} from '../recountPolicy';
import type { CountNumber } from '../physicalCountTypes';

function item(erp: number, physical: number | null, elsewhere = 0): MeasurableItem {
  return { erpQuantitySnapshot: erp, physicalQuantity: physical, foundElsewhereQuantity: elsewhere };
}

function settings(overrides: Partial<RecountSettings> = {}): RecountSettings {
  return { ...DEFAULT_RECOUNT_SETTINGS, enabled: true, ...overrides };
}

function decide(items: MeasurableItem[], overrides: Partial<RecountSettings> = {}, countNumber: CountNumber = 1) {
  return decideRecount({ settings: settings(overrides), items, countNumber });
}

describe('measureDivergence', () => {
  it('conta apenas itens já contados', () => {
    // Incluir pendentes trataria "não contado" como "contado zero", inflando o
    // desvio e disparando recontagem por itens que ninguém olhou.
    const measure = measureDivergence([item(10, 10), item(10, null), item(5, null)]);
    expect(measure.countedItems).toBe(1);
    expect(measure.erpTotal).toBe(10);
  });

  it('soma o excedente achado em outro local ao total físico', () => {
    // Mesma regra que a 041 usa em pc_finalize_session. Sem isso, um item achado
    // fora do lugar contaria como divergência aqui e como 'ok' na tela.
    const measure = measureDivergence([item(10, 6, 4)]);
    expect(measure.divergentItems).toBe(0);
    expect(measure.absoluteUnitDeviation).toBe(0);
  });

  it('usa desvio ABSOLUTO, não líquido', () => {
    // +50 e −50 somam zero no líquido. Um estoque com cem unidades no lugar errado
    // não é um estoque correto, e é exatamente o caso que mais pede recontagem.
    const measure = measureDivergence([item(100, 150), item(100, 50)]);
    expect(measure.absoluteUnitDeviation).toBe(100);
    expect(measure.divergentItems).toBe(2);
  });

  it('conta falta e sobra igualmente como divergência', () => {
    const measure = measureDivergence([item(10, 8), item(10, 12)]);
    expect(measure.divergentItems).toBe(2);
    expect(measure.absoluteUnitDeviation).toBe(4);
  });

  it('trata ERP nulo como zero', () => {
    const measure = measureDivergence([{ erpQuantitySnapshot: null, physicalQuantity: 3 }]);
    expect(measure.divergentItems).toBe(1);
    expect(measure.absoluteUnitDeviation).toBe(3);
  });

  it('lida com sessão vazia', () => {
    expect(measureDivergence([])).toEqual({
      countedItems: 0,
      divergentItems: 0,
      absoluteUnitDeviation: 0,
      erpTotal: 0,
      physicalTotal: 0,
    });
  });

  it('contado zero contra ERP positivo é divergência real', () => {
    // Contar zero é um resultado, diferente de não contar.
    const measure = measureDivergence([item(7, 0)]);
    expect(measure.countedItems).toBe(1);
    expect(measure.divergentItems).toBe(1);
    expect(measure.absoluteUnitDeviation).toBe(7);
  });
});

describe('measuredValueFor', () => {
  const measure = measureDivergence([item(100, 90), item(100, 100), item(100, 100), item(100, 100)]);

  it('divergent_item_percent usa itens, não unidades', () => {
    // 1 de 4 itens divergentes.
    expect(measuredValueFor('divergent_item_percent', measure)).toBe(25);
  });

  it('unit_deviation_percent usa unidades sobre o total do ERP', () => {
    // 10 de 400 unidades.
    expect(measuredValueFor('unit_deviation_percent', measure)).toBe(2.5);
  });

  it('absolute_unit_deviation devolve as unidades', () => {
    expect(measuredValueFor('absolute_unit_deviation', measure)).toBe(10);
  });

  it('os três modos discordam sobre o mesmo dado', () => {
    // A razão pela qual os modos têm nomes explícitos: 25%, 2,5% e 10 descrevem a
    // mesma contagem. Alguém que configurasse "5" sem saber qual modo está ativo
    // dispararia num caso e não no outro.
    const values = (['divergent_item_percent', 'unit_deviation_percent', 'absolute_unit_deviation'] as const).map(
      t => measuredValueFor(t, measure)
    );
    expect(new Set(values).size).toBe(3);
  });

  it('protege a divisão sem itens contados', () => {
    // NaN compararia falso contra qualquer limite e desligaria a automação em
    // silêncio para aquela sessão.
    const empty = measureDivergence([]);
    for (const type of ['divergent_item_percent', 'unit_deviation_percent', 'absolute_unit_deviation'] as const) {
      const value = measuredValueFor(type, empty);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(0);
    }
  });

  it('mede contra o total físico quando o ERP total é zero', () => {
    // Faixa zerada no ERP e algo encontrado. Antes da migration 050 o percentual
    // por unidade caía para 0 aqui; agora usa o total físico como base e mede 100%.
    // Cenário detalhado no bloco 'saldo zero no ERP' mais abaixo.
    const measure = measureDivergence([item(0, 5)]);
    expect(measuredValueFor('unit_deviation_percent', measure)).toBe(100);
    expect(measuredValueFor('divergent_item_percent', measure)).toBe(100);
    expect(measuredValueFor('absolute_unit_deviation', measure)).toBe(5);
  });
});

describe('decideRecount', () => {
  it('não faz nada quando está desligado', () => {
    // O padrão. Quem não configurou mantém o fluxo manual.
    const decision = decideRecount({
      settings: DEFAULT_RECOUNT_SETTINGS,
      items: [item(10, 0), item(10, 0)],
      countNumber: 1,
    });
    expect(decision).toMatchObject({ action: 'skip', reason: 'disabled' });
  });

  it('DEFAULT_RECOUNT_SETTINGS vem desligado', () => {
    expect(DEFAULT_RECOUNT_SETTINGS.enabled).toBe(false);
  });

  it('cria quando passa do limite', () => {
    // 2 de 4 itens = 50%, limite 5%.
    const decision = decide([item(10, 8), item(10, 12), item(10, 10), item(10, 10)], {
      thresholdType: 'divergent_item_percent',
      thresholdValue: 5,
    });
    expect(decision.action).toBe('create');
    expect(decision.measuredValue).toBe(50);
  });

  it('não cria abaixo do limite', () => {
    // 1 de 100 = 1%, limite 5%.
    const items = [item(10, 8), ...Array.from({ length: 99 }, () => item(10, 10))];
    const decision = decide(items, { thresholdType: 'divergent_item_percent', thresholdValue: 5 });
    expect(decision).toMatchObject({ action: 'skip', reason: 'below_threshold' });
  });

  it('dispara exatamente NO limite', () => {
    // Decisão de projeto: "ultrapassar" foi lido como >=. Quem configura 5%
    // querendo recontar a partir de 5% espera que 5% dispare. O SQL usa a mesma
    // comparação (< limite = ignora), então as duas camadas concordam.
    const items = [item(10, 8), ...Array.from({ length: 19 }, () => item(10, 10))];
    const decision = decide(items, { thresholdType: 'divergent_item_percent', thresholdValue: 5 });
    expect(decision.measuredValue).toBe(5);
    expect(decision.action).toBe('create');
  });

  it('não cria na última rodada', () => {
    // pc_create_recount_session recusa acima de 3; a decisão dá o motivo legível
    // antes de tentar.
    const decision = decide([item(10, 0)], {}, MAX_COUNT_ROUNDS as CountNumber);
    expect(decision).toMatchObject({ action: 'skip', reason: 'max_rounds_reached' });
  });

  it('cria na penúltima rodada', () => {
    const decision = decide([item(10, 0)], {}, 2);
    expect(decision.action).toBe('create');
  });

  it('sessão sem divergência sempre para no limite, para qualquer limite positivo', () => {
    // Consequência de o CHECK do banco exigir threshold_value > 0: desvio zero
    // nunca alcança um limite positivo. Ou seja, o ramo `no_divergent_items` é
    // INALCANÇÁVEL pela avaliação automática — o motivo real é sempre
    // below_threshold. O guarda existe abaixo, não aqui.
    for (const thresholdValue of [0.0001, 1, 5, 100]) {
      for (const thresholdType of ['divergent_item_percent', 'unit_deviation_percent', 'absolute_unit_deviation'] as const) {
        const decision = decide([item(10, 10), item(20, 20)], { thresholdType, thresholdValue });
        expect(decision).toMatchObject({ action: 'skip', reason: 'below_threshold' });
      }
    }
  });

  it('o guarda de no_divergent_items protege um limite zero vindo do código', () => {
    // O tipo TypeScript aceita 0, o CHECK do banco não. Então este caminho só é
    // alcançável por um chamador da pré-visualização passando 0 — e aí o guarda
    // evita prometer uma recontagem que pc_create_recount_session recusaria por
    // não ter item nenhum para copiar.
    const decision = decide([item(10, 10)], {
      thresholdType: 'absolute_unit_deviation',
      thresholdValue: 0,
    });
    expect(decision).toMatchObject({ action: 'skip', reason: 'no_divergent_items' });
  });

  it('verifica desligado ANTES do limite', () => {
    // Dizer "abaixo do limite" para quem tem a automação desligada manda a pessoa
    // ajustar o número errado.
    const decision = decideRecount({
      settings: { ...settings(), enabled: false, thresholdValue: 1 },
      items: [item(10, 0)],
      countNumber: 1,
    });
    expect(decision).toMatchObject({ reason: 'disabled' });
  });

  it('verifica limite ANTES de rodadas', () => {
    // Numa 3ª contagem com divergência pequena, o motivo verdadeiro é o limite, não
    // a rodada — mandar procurar limite de rodadas esconderia que nem passaria.
    const items = [item(10, 10), item(10, 10)];
    const decision = decide(items, { thresholdValue: 50 }, 3);
    expect(decision).toMatchObject({ reason: 'below_threshold' });
  });

  it('devolve a medida junto da decisão em todos os caminhos', () => {
    // A explicação é gerada da mesma decisão, então não pode discordar dela.
    const paths = [
      decideRecount({ settings: DEFAULT_RECOUNT_SETTINGS, items: [item(10, 0)], countNumber: 1 }),
      decide([item(10, 10)]),
      decide([item(10, 0)]),
      decide([item(10, 0)], {}, 3),
    ];
    for (const decision of paths) {
      expect(decision.measure).toBeDefined();
      expect(Number.isFinite(decision.measuredValue)).toBe(true);
    }
  });

  it('espelha a fórmula do SQL', () => {
    // Documenta a fórmula que pc_evaluate_auto_recount usa. Se as duas divergirem,
    // este é o teste que precisa mudar — e mudá-lo obriga a olhar o SQL.
    //
    //   divergent_item_percent  = divergent_items / counted_items * 100
    //   unit_deviation_percent  = absolute_unit_deviation / erp_total * 100
    //   absolute_unit_deviation = absolute_unit_deviation
    //   dispara quando  measured >= threshold   (SQL: skip se measured < threshold)
    const items = [item(50, 40), item(50, 50)];
    const measure = measureDivergence(items);

    expect(measure).toEqual({
      countedItems: 2,
      divergentItems: 1,
      absoluteUnitDeviation: 10,
      erpTotal: 100,
      physicalTotal: 90,
    });
    expect(measuredValueFor('divergent_item_percent', measure)).toBe((1 / 2) * 100);
    expect(measuredValueFor('unit_deviation_percent', measure)).toBe((10 / 100) * 100);
    expect(measuredValueFor('absolute_unit_deviation', measure)).toBe(10);
  });
});

describe('formatação e texto', () => {
  it('marca os modos percentuais', () => {
    expect(isPercentThreshold('divergent_item_percent')).toBe(true);
    expect(isPercentThreshold('unit_deviation_percent')).toBe(true);
    expect(isPercentThreshold('absolute_unit_deviation')).toBe(false);
  });

  it('arredonda percentual a uma casa', () => {
    // Sem arredondar sai '12.400000000000002%'.
    expect(formatMeasured('divergent_item_percent', 12.400000000000002)).toBe('12,4%');
  });

  it('arredonda unidade para inteiro', () => {
    // Meia unidade de desvio não é uma ideia útil.
    expect(formatMeasured('absolute_unit_deviation', 10.6)).toBe('11 un.');
  });

  it('a explicação cita o valor medido e o limite', () => {
    const config = settings({ thresholdType: 'divergent_item_percent', thresholdValue: 5 });
    const decision = decideRecount({
      settings: config,
      items: [item(10, 8), item(10, 10)],
      countNumber: 1,
    });
    const text = describeDecision(decision, config);
    expect(text).toContain('50%');
    expect(text).toContain('5%');
  });

  it('a explicação do abaixo-do-limite também traz os dois números', () => {
    const config = settings({ thresholdValue: 90 });
    const decision = decideRecount({ settings: config, items: [item(10, 8), item(10, 10)], countNumber: 1 });
    const text = describeDecision(decision, config);
    expect(text).toContain('50%');
    expect(text).toContain('90%');
  });

  it('todo modo tem rótulo e ajuda', () => {
    // A ajuda é o que impede a pessoa de escolher o modo errado.
    const types: RecountThresholdType[] = [
      'divergent_item_percent',
      'unit_deviation_percent',
      'absolute_unit_deviation',
    ];
    for (const type of types) {
      expect(formatMeasured(type, 1).length).toBeGreaterThan(0);
      expect(isPercentThreshold(type)).toBe(type !== 'absolute_unit_deviation');
    }
    expect(types).toHaveLength(3);
  });
});

describe('saldo zero no ERP — a correção da migration 050', () => {
  // Dois casos reais deste banco: 7 itens somando 800 unidades contra saldo zero, e
  // 1 item com 8.790 contra saldo zero. Antes da 050 os dois mediam 0% no modo por
  // unidade e a automação os ignorava por completo.
  const realCase8790 = measureDivergence([item(0, 8790)]);
  const realCase800 = measureDivergence(Array.from({ length: 7 }, () => item(0, 800 / 7)));

  it('reproduz o caso real', () => {
    expect(realCase8790).toEqual({
      countedItems: 1,
      divergentItems: 1,
      absoluteUnitDeviation: 8790,
      erpTotal: 0,
      physicalTotal: 8790,
    });
  });

  it('mede 100% em vez de 0%', () => {
    // Com saldo esperado zero, todo o encontrado era inesperado. É a mesma medida
    // contra a única base que existe, não uma regra especial — e continua sendo um
    // percentual comparável ao limite.
    expect(measuredValueFor('unit_deviation_percent', realCase8790)).toBe(100);
    expect(measuredValueFor('unit_deviation_percent', realCase800)).toBe(100);
  });

  it('agora dispara, com qualquer limite razoável', () => {
    for (const thresholdValue of [0.1, 5, 50, 100]) {
      expect(
        decide([item(0, 8790)], { thresholdType: 'unit_deviation_percent', thresholdValue }).action
      ).toBe('create');
    }
  });

  it('os três modos concordam neste caso', () => {
    // Antes da 050 o modo por unidade discordava dos outros dois — 0% contra 100% e
    // 8.790. Concordar aqui é o sinal de que a correção alinhou as três leituras.
    expect(measuredValueFor('divergent_item_percent', realCase8790)).toBe(100);
    expect(measuredValueFor('unit_deviation_percent', realCase8790)).toBe(100);
    expect(measuredValueFor('absolute_unit_deviation', realCase8790)).toBe(8790);

    for (const thresholdType of [
      'divergent_item_percent',
      'unit_deviation_percent',
      'absolute_unit_deviation',
    ] as const) {
      expect(decide([item(0, 8790)], { thresholdType, thresholdValue: 5 }).action).toBe('create');
    }
  });

  it('não muda nada quando o ERP tem saldo', () => {
    // O escopo da correção: só alcança o caso em que a definição anterior era
    // indefinida. 10 de 400 unidades continua sendo 2,5%.
    const normal = measureDivergence([item(100, 90), item(100, 100), item(100, 100), item(100, 100)]);
    expect(measuredValueFor('unit_deviation_percent', normal)).toBe(2.5);
    expect(usedPhysicalBase('unit_deviation_percent', normal)).toBe(false);
  });

  it('as duas bases em zero medem zero, sem NaN', () => {
    // Faixa contada e nada encontrado, ERP também zero: não há divergência, e a
    // ausência de denominador não pode virar NaN nem disparar.
    const bothZero = measureDivergence([item(0, 0)]);
    const value = measuredValueFor('unit_deviation_percent', bothZero);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(0);
    expect(decide([item(0, 0)], { thresholdType: 'unit_deviation_percent' })).toMatchObject({
      action: 'skip',
      reason: 'below_threshold',
    });
  });

  it('funciona também quando falta estoque contra ERP zero', () => {
    // Caso inverso e mais raro: ERP zero, físico zero num item e sobra em outro.
    // A base é o total físico, então continua definido.
    const mixed = measureDivergence([item(0, 0), item(0, 40)]);
    expect(mixed.physicalTotal).toBe(40);
    expect(measuredValueFor('unit_deviation_percent', mixed)).toBe(100);
  });

  it('usedPhysicalBase marca exatamente quando a base alternativa foi usada', () => {
    // A frase muda: "100% do que foi encontrado era inesperado" não é a mesma
    // afirmação que "100% do saldo esperado divergiu".
    expect(usedPhysicalBase('unit_deviation_percent', realCase8790)).toBe(true);
    // Outros modos nunca usam essa base.
    expect(usedPhysicalBase('divergent_item_percent', realCase8790)).toBe(false);
    expect(usedPhysicalBase('absolute_unit_deviation', realCase8790)).toBe(false);
    // Sem desvio não há base alternativa em uso.
    expect(usedPhysicalBase('unit_deviation_percent', measureDivergence([item(0, 0)]))).toBe(false);
  });

  it('o padrão da empresa continua sendo o modo por item', () => {
    // Não mudou com a 050 — só deixou de ser a única opção segura.
    expect(DEFAULT_RECOUNT_SETTINGS.thresholdType).toBe('divergent_item_percent');
  });
});
