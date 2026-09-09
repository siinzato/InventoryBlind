// Classificação Marca > Linha com prioridade — os casos que o modelo anterior errava.
//
// Os títulos dos fixtures carregam o token da marca porque `products` não tem coluna de marca,
// categoria ou tipo: o título é o único sinal disponível, e todo produto GoCase real do
// catálogo traz "Gocase" no nome.
//
// A regra central: dentro da marca, a CATEGORIA do que o produto é (lancheira, mochila, base,
// térmico) vence o NOME que ele tem (puffer, joy, tote). Sem isso, "Lancheira Puffer Rosa"
// caía na linha Puffer, inflando a linha errada e deixando Lancheiras subcontada.

import { describe, expect, it } from 'vitest';
import { classifyProductTitle, type ClassifierBrand, type ClassifierLine } from '../brandClassifier';

const line = (id: string, name: string, keywords: string[], matchPriority: number, excludeKeywords: string[] = []): ClassifierLine =>
  ({ id, name, keywords, active: true, matchPriority, excludeKeywords });

// Espelha exatamente as linhas reais da GoCase e as prioridades da migration 110.
const GOCASE_LINES: ClassifierLine[] = [
  // OUTLET tem prioridade absoluta: menor match_priority da marca (migration 111).
  line('outlet', 'Outlet', ['outlet'], 1),
  line('lancheiras', 'Lancheiras e Necessários', ['lancheira', 'lancheiras', 'necessaire', 'necessaires', 'necessario', 'necessarios', 'marmiteira', 'marmita'], 10),
  line('ventosa', 'Ventosa', ['ventosa', 'ventosas'], 12),
  // Bases acima de Térmicos: senão "garrafa" venceria "base" em "Base de Silicone Garrafa Fresh".
  line('bases', 'Bases', ['base de silicone', 'base de garrafa', 'base para garrafa', 'base garrafa', 'base', 'bases', 'suporte', 'stand', 'dock'], 15),
  // Garrafa e copo têm linha própria acima de Térmicos: "térmico" descreve a característica
  // do produto, não define o tipo dele. Térmicos só recebe o que não é nenhum dos dois.
  // Tampa acima de garrafa: uma tampa PARA garrafa não é uma garrafa.
  line('tampas', 'Tampa de Garrafa', ['tampa de garrafa', 'tampa para garrafa', 'tampas para garrafas', 'tampa gocase garrafas', 'tampa gocase garrafa'], 14),
  line('garrafas', 'Garrafas Térmicas', ['garrafa termica', 'garrafas termicas', 'garrafa'], 16),
  line('copos', 'Copos Térmicos', ['copo termico', 'copos termicos', 'copo', 'copos'], 17),
  line('termicos', 'Térmicos', ['termico', 'termica', 'termicos', 'termicas', 'squeeze'], 20),
  line('mochilas', 'Mochilas e Tote Daily', ['mochila', 'mochilas', 'tote daily', 'bolsa tote daily'], 40),
  line('joy', 'Joy', ['joy'], 60),
  line('puffer', 'Puffer', ['puffer'], 70),
  line('capas', 'Capas', ['capa', 'capas', 'case'], 80),
];

const BRANDS: ClassifierBrand[] = [
  // "base de silicone" é alias de marca: as bases de garrafa não trazem o token GoCase no título.
  { id: 'gocase', name: 'GoCase', keywords: ['GC', 'base de silicone'], active: true, lines: GOCASE_LINES },
  { id: 'ringke', name: 'Ringke', keywords: [], active: true, lines: [] },
  { id: 'nillkin', name: 'Nillkin', keywords: [], active: true, lines: [] },
];

const classify = (title: string) => classifyProductTitle(title, BRANDS);

describe('prioridade dentro da marca — categoria vence modelo', () => {
  it('Lancheira Puffer vai para Lancheiras e Necessários, NUNCA para Puffer', () => {
    const r = classify('Lancheira Puffer Gocase Rosa');
    expect(r.status).toBe('auto');
    expect(r.brandId).toBe('gocase');
    expect(r.lineId).toBe('lancheiras');
    expect(r.lineId).not.toBe('puffer');
  });

  it('Capa Puffer vai para Puffer', () => {
    expect(classify('Capa Puffer MagSafe Gocase iPhone 16 Rosa').lineId).toBe('puffer');
  });

  it('Capa Joy vai para Joy, não para Capas', () => {
    expect(classify('Capa Joy Gocase iPhone 16').lineId).toBe('joy');
  });

  it('mochila com nome de linha no título vai para Mochilas', () => {
    expect(classify('Mochila Joy Gocase Escolar').lineId).toBe('mochilas');
    expect(classify('Gocase Mochila Pop Bolsa Reforçada Escolar').lineId).toBe('mochilas');
  });

  it('base com nome de linha no título vai para Bases', () => {
    // O caso que comprimento de termo resolveria errado: "puffer"(6) > "base"(4).
    expect(classify('Base Puffer Gocase para iPhone').lineId).toBe('bases');
  });

  it('térmico vence modelo', () => {
    expect(classify('Garrafa Térmica Fresh Gocase 650ml Good Vibes').lineId).toBe('garrafas');
    expect(classify('Garrafa Térmica Joy Gocase 500ml').lineId).toBe('garrafas');
  });

  it('Tote Daily vai para Mochilas e Tote Daily', () => {
    expect(classify('Bolsa Tote Daily Clear Gocase - Preto').lineId).toBe('mochilas');
  });

  it('marmiteira é Lancheiras e Necessários', () => {
    expect(classify('Marmiteira Duo Gocase - Melancia').lineId).toBe('lancheiras');
  });
});

describe('fallback e ausência de linha', () => {
  it('capa GoCase sem linha específica cai em Capas', () => {
    expect(classify('Capa Anti Impacto Gocase Slim Air - Galaxy A36 - Transparente').lineId).toBe('capas');
  });

  it('produto GoCase que não é capa nem linha conhecida fica SEM linha, para revisão', () => {
    // Peitoral para cachorro não é capa: inventar "Capas" aqui seria dado falso.
    const r = classify('Gocase Peitoral Para Cachorro Modelo Clear - Azul Marinho');
    expect(r.brandId).toBe('gocase');
    expect(r.lineId).toBeNull();
    expect(r.status).toBe('auto');
  });

  it('marca sem linhas cadastradas resolve marca e linha nula', () => {
    const ringke = classify('Case Ringke Fusion transparente');
    expect(ringke.brandId).toBe('ringke');
    expect(ringke.lineId).toBeNull();

    const nillkin = classify('Capa Nillkin CamShield para iPhone 15');
    expect(nillkin.brandId).toBe('nillkin');
    expect(nillkin.lineId).toBeNull();
  });

  it('produto sem marca conhecida fica unmatched, sem linha inventada', () => {
    const r = classify('Cabo genérico USB 2 metros');
    expect(r.status).toBe('unmatched');
    expect(r.brandId).toBeNull();
    expect(r.lineId).toBeNull();
  });
});

describe('determinismo e travas', () => {
  it('a mesma entrada dá sempre a mesma saída', () => {
    expect(classify('Lancheira Puffer Gocase Rosa')).toEqual(classify('Lancheira Puffer Gocase Rosa'));
  });

  it('exclude_keywords elimina a linha mesmo com termo positivo', () => {
    const brands: ClassifierBrand[] = [{
      id: 'gocase', name: 'GoCase', keywords: [], active: true,
      lines: [line('puffer', 'Puffer', ['puffer'], 70, ['lancheira'])],
    }];
    expect(classifyProductTitle('Lancheira Puffer Gocase', brands).lineId).toBeNull();
    expect(classifyProductTitle('Capa Puffer Gocase', brands).lineId).toBe('puffer');
  });

  it('empate real de prioridade e especificidade vai para revisão, não escolhe às cegas', () => {
    const brands: ClassifierBrand[] = [{
      id: 'gocase', name: 'GoCase', keywords: [], active: true,
      lines: [line('a', 'AAAAA', ['alfa'], 50), line('b', 'BBBBB', ['beta'], 50)],
    }];
    const r = classifyProductTitle('Produto Gocase alfa beta', brands);
    expect(r.status).toBe('needs_review');
    expect(r.lineId).toBeNull();
    expect(r.lineCandidates.map(c => c.lineId).sort()).toEqual(['a', 'b']);
  });

  it('linha inativa nunca é escolhida', () => {
    const brands: ClassifierBrand[] = [{
      id: 'gocase', name: 'GoCase', keywords: [], active: true,
      lines: [{ ...line('puffer', 'Puffer', ['puffer'], 70), active: false }],
    }];
    expect(classifyProductTitle('Capa Puffer Gocase', brands).lineId).toBeNull();
  });

  it('o nome da linha funciona como palavra-chave, sem alias cadastrado', () => {
    const brands: ClassifierBrand[] = [{
      id: 'gocase', name: 'GoCase', keywords: [], active: true,
      lines: [line('joy', 'Joy', [], 60)],
    }];
    expect(classifyProductTitle('Bolsa Joy Gocase', brands).lineId).toBe('joy');
  });

  it('termo só casa como palavra inteira: "based" não é "base"', () => {
    expect(classify('Capa Gocase Based Design').lineId).toBe('capas');
  });
});

describe('OUTLET tem prioridade absoluta dentro da GoCase', () => {
  // Precedência exigida na correção: OUTLET encerra a classificação antes de qualquer outra
  // regra, então o produto sai da linha de modelo/categoria e passa a pertencer só a Outlet.
  const cases: [string, string][] = [
    ['OUTLET Lancheira Puffer Gocase Rosa', 'outlet'],
    ['Lancheira Puffer Gocase OUTLET', 'outlet'],
    ['OUTLET Mochila Gocase', 'outlet'],
    ['Capa Joy Gocase iPhone 15 OUTLET', 'outlet'],
    ['Bolsa Tote Daily Gocase Preta - Outlet', 'outlet'],
    ['Base de Garrafa Gocase Outlet', 'outlet'],
    ['Ventosa Gocase Outlet', 'outlet'],
    ['Capa Puffer Gocase Rosa OUTLET', 'outlet'],
    ['Garrafa Térmica Gocase 650ml outlet', 'outlet'],
  ];

  it.each(cases)('%s -> Outlet', (title, expected) => {
    const r = classify(title);
    expect(r.status).toBe('auto');
    expect(r.lineId).toBe(expected);
  });

  it('sem OUTLET no título a linha original é preservada', () => {
    expect(classify('Lancheira Puffer Gocase Rosa').lineId).toBe('lancheiras');
    expect(classify('Capa Puffer Gocase Rosa').lineId).toBe('puffer');
    expect(classify('Capa Joy Gocase iPhone 15').lineId).toBe('joy');
    expect(classify('Bolsa Tote Daily Gocase Preta').lineId).toBe('mochilas');
  });

  it('OUTLET casa por palavra inteira e ignora pontuação/caixa', () => {
    expect(classify('Gocase Copo Vibe - OUTLET, leves defeitos').lineId).toBe('outlet');
    // "outleta" não é OUTLET: casamento por palavra inteira, nunca por substring.
    expect(classify('Capa Gocase Outleta Design').lineId).toBe('capas');
  });
});

describe('Ventosa e Bases de garrafa', () => {
  it('ventosa real do catálogo vai para Ventosa', () => {
    expect(classify('Ventosa de Silicone Gocase Para Capinha - Azul').lineId).toBe('ventosa');
    expect(classify('Suporte Ventosa Gocase MagSafe').lineId).toBe('ventosa');
  });

  it('bases de garrafa reais do catálogo vão para Bases, não para Térmicos', () => {
    // Marca resolvida pelo alias "base de silicone": o título não traz o token GoCase.
    const r = classify('Base de Silicone Garrafa Fresh 650ml - Rosa');
    expect(r.brandId).toBe('gocase');
    expect(r.lineId).toBe('bases');

    expect(classify('Base de Silicone Fit G - Garrafa Fresh 950ml / Garrafa Fresh 1200ml - Branco').lineId).toBe('bases');
    expect(classify('Base de Silicone Para Copo Life 1180ml e Garrafa Flip Pro 750ml - Preto').lineId).toBe('bases');
    expect(classify('Base de Silicone Para Garrafa Urban 500ml - Lemon').lineId).toBe('bases');
  });

  it('base e ventosa continuam perdendo para OUTLET', () => {
    expect(classify('Base de Silicone Garrafa Fresh 650ml - Rosa OUTLET').lineId).toBe('outlet');
    expect(classify('Ventosa de Silicone Gocase Para Capinha OUTLET').lineId).toBe('outlet');
  });

  it('garrafa térmica sem base vai para Garrafas Térmicas', () => {
    expect(classify('Garrafa Térmica Fresh Gocase 650ml Good Vibes').lineId).toBe('garrafas');
  });
});

// Correção da família térmica: garrafa, copo e lancheira são TIPOS de produto; "térmico" é só
// uma característica. Antes, qualquer título com "térmica" caía em Térmicos.
describe('família térmica — o tipo do produto vence a característica', () => {
  it('lancheira térmica continua em Lancheiras, com qualquer litragem ou modelo', () => {
    expect(classify('Lancheira Térmica Puffer Gocase').lineId).toBe('lancheiras');
    expect(classify('Lancheira Térmica Gocase 6L').lineId).toBe('lancheiras');
    expect(classify('Gocase Lancheira Térmica Marmiteira - Rosa').lineId).toBe('lancheiras');
  });

  it('garrafa térmica vai para Garrafas Térmicas, e a litragem não muda a linha', () => {
    for (const title of ['Garrafa Térmica Gocase 650ml', 'Garrafa Térmica Gocase 1L', 'Garrafa Termica Gocase Rosa', 'Garrafa Térmica Gocase 1200ml']) {
      expect(classify(title).lineId).toBe('garrafas');
    }
    // Título real do catálogo sem a palavra "térmica".
    expect(classify('Garrafa Gocase Fresh Poeira das Estrelas - 950ml - Lilás').lineId).toBe('garrafas');
  });

  it('copo térmico vai para Copos Térmicos, e capacidade/cor não mudam a linha', () => {
    for (const title of ['Copo Térmico Gocase 500ml', 'Copo Termico Gocase com Tampa', 'Copo Térmico Gocase Vibe 470ml - Preto', 'Copo Térmico Daily Gocase Aço Inoxidável - 600ml - Rosa']) {
      expect(classify(title).lineId).toBe('copos');
    }
  });

  it('térmico que não é garrafa nem copo permanece em Térmicos', () => {
    expect(classify('Taça Térmica Drink Gocase Aço Inox - 420ml - Preto').lineId).toBe('termicos');
    expect(classify('Gocase Bolsa Térmica Daily Escola Faculdade Trabalho - Preto').lineId).toBe('termicos');
  });

  it('OUTLET vence qualquer térmico', () => {
    expect(classify('Lancheira Térmica Gocase OUTLET').lineId).toBe('outlet');
    expect(classify('Garrafa Térmica Gocase 650ml OUTLET').lineId).toBe('outlet');
    expect(classify('Copo Térmico Gocase OUTLET').lineId).toBe('outlet');
  });

  it('base e tampa de garrafa não são arrastadas para as linhas novas', () => {
    expect(classify('Base de Silicone Fit G - Garrafa Fresh 950ml - Azul Claro').lineId).toBe('bases');
    expect(classify('Base de Silicone Para Copo Life 1180ml - Preto').lineId).toBe('bases');
    expect(classify('Tampa Gocase Garrafas 950ml, 650ml, 350ml e 1200ml - Azul').lineId).toBe('tampas');
    expect(classify('Tampa de Garrafa Gocase 650ml - Rosa').lineId).toBe('tampas');
  });
});
