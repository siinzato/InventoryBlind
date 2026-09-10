// I.B Academy — conteúdo estático (Método I.B.®, 7 Pilares, Central de Conhecimento).
// Fixo e igual para todos os tenants — não editável pelo usuário, por isso não é DB.
// Só Pilar 1 (organizacao) tem conteúdo completo nesta fase; os outros 6 são placeholder
// (isPlaceholder: true), prontos para receber conteúdo real numa fase seguinte.

export const METODO_IB_INTRO = {
  title: 'O que é o Método I.B.®',
  philosophyQuote: 'Um inventário perfeito não começa na contagem.\nEle começa na organização.',
  sections: [
    {
      heading: 'Uma metodologia, não apenas um curso',
      body: 'O Método I.B.® é a metodologia oficial InventoryBlind para ensinar empresas a construírem processos de estoque altamente confiáveis. Ele não ensina apenas a contar produtos — ensina toda a preparação que antecede um inventário de excelência.',
    },
    {
      heading: 'O Inventário Cego é consequência, não ponto de partida',
      body: 'O Inventário Cego é apenas um dos pilares. Ele é consequência de um estoque organizado, endereçado, padronizado e preparado. Pular direto para a contagem sem essa base é a razão pela qual a maioria dos inventários revela divergências que já existiam há meses.',
    },
    {
      heading: 'Os 7 Pilares',
      body: 'Toda a I.B Academy é construída sobre 7 Pilares, em ordem: Organização, Endereçamento, Padronização, Preparação, Inventário Cego, Validação e Inteligência. Cada trilha e cada curso da Academy referencia um ou mais destes pilares.',
    },
  ],
} as const;

export type PilarKey =
  | 'organizacao'
  | 'enderecamento'
  | 'padronizacao'
  | 'preparacao'
  | 'inventario_cego'
  | 'validacao'
  | 'inteligencia';

export interface PilarHeading {
  h: string;
  bullets: string[];
}

export interface PilarContent {
  key: PilarKey;
  order: number;
  title: string;
  icon: string;
  teaser: string;
  headings: PilarHeading[];
  impactQuotes: string[];
  isPlaceholder: boolean;
}

export const PILARES: PilarContent[] = [
  {
    key: 'organizacao',
    order: 1,
    title: 'Organização',
    icon: 'LayoutGrid',
    teaser: 'O inventário começa muito antes da contagem — na organização física e visual do estoque.',
    isPlaceholder: false,
    headings: [
      {
        h: 'Organização física',
        bullets: [
          'Produtos guardados de forma consistente, sem misturar SKUs diferentes no mesmo espaço',
          'Caixas abertas identificadas e separadas — nunca espalhadas soltas',
          'Produtos avariados isolados dos produtos saudáveis',
        ],
      },
      {
        h: 'Organização visual e layout',
        bullets: [
          'Qualquer pessoa consegue olhar uma posição e entender o que deveria estar ali',
          'Setorização clara por categoria, giro ou linha',
          'Corredores e vãos livres de obstrução',
        ],
      },
      {
        h: 'Identificação e boas práticas',
        bullets: [
          'Toda posição, prateleira e caixa com etiqueta legível e padronizada',
          'Produtos fora do endereço correto corrigidos antes da contagem',
          'Limpeza do estoque como parte da rotina, não como exceção',
        ],
      },
    ],
    impactQuotes: [
      'Organização reduz erros antes mesmo da primeira contagem.',
      'Um estoque organizado vale mais do que um inventário bem executado.',
    ],
  },
  {
    key: 'enderecamento',
    order: 2,
    title: 'Endereçamento',
    icon: 'MapPin',
    teaser: 'Endereçamento inteligente: ruas, corredores, vãos e mapeamento sem ambiguidade.',
    isPlaceholder: true,
    headings: [
      { h: 'Conteúdo completo em breve', bullets: ['Endereçamento inteligente', 'Ruas e corredores', 'Vãos e excesso', 'Mapeamento e etiquetas', 'Organização por setores', 'Boas práticas'] },
    ],
    impactQuotes: [],
  },
  {
    key: 'padronizacao',
    order: 3,
    title: 'Padronização',
    icon: 'ListChecks',
    teaser: 'Padronização de etiquetas, excessos, processos, operadores e procedimentos.',
    isPlaceholder: true,
    headings: [
      { h: 'Conteúdo completo em breve', bullets: ['Padronização do estoque', 'Padronização das etiquetas', 'Padronização dos excessos', 'Regras operacionais', 'Procedimentos e checklists'] },
    ],
    impactQuotes: [],
  },
  {
    key: 'preparacao',
    order: 4,
    title: 'Preparação',
    icon: 'ClipboardCheck',
    teaser: 'O inventário começa dias antes. Nunca no dia da contagem.',
    isPlaceholder: true,
    headings: [
      { h: 'O inventário começa dias antes', bullets: ['Nunca no dia da contagem — a preparação é o que garante um inventário confiável.'] },
    ],
    impactQuotes: [],
  },
  {
    key: 'inventario_cego',
    order: 5,
    title: 'Inventário Cego',
    icon: 'EyeOff',
    teaser: 'Somente agora, com a base pronta, o conceito de Inventário Cego é apresentado.',
    isPlaceholder: true,
    headings: [
      { h: 'Conteúdo completo em breve', bullets: ['Conceito e objetivo', 'Benefícios e redução do viés', 'Primeira, segunda e terceira contagem', 'Divergência real', 'Auditoria'] },
    ],
    impactQuotes: [],
  },
  {
    key: 'validacao',
    order: 6,
    title: 'Validação',
    icon: 'ShieldCheck',
    teaser: 'Auditoria, recontagem, confirmação e rastreabilidade total.',
    isPlaceholder: true,
    headings: [
      { h: 'Conteúdo completo em breve', bullets: ['Auditoria', 'Recontagem e confirmação', 'Sobra e falta', 'Rastreabilidade e evidências'] },
    ],
    impactQuotes: [],
  },
  {
    key: 'inteligencia',
    order: 7,
    title: 'Inteligência',
    icon: 'BrainCircuit',
    teaser: 'Transformar inventários em decisões: KPIs, HeatMap, produtividade e planos de ação.',
    isPlaceholder: true,
    headings: [
      { h: 'Conteúdo completo em breve', bullets: ['KPIs e HeatMap', 'Dashboard Financeiro', 'Produtividade e Ranking', 'Relatórios e IA', 'Planos de ação e tomada de decisão'] },
    ],
    impactQuotes: [],
  },
];

export const PILAR4_CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'pilar4_item_1', label: 'Estoque limpo' },
  { key: 'pilar4_item_2', label: 'Estoque organizado' },
  { key: 'pilar4_item_3', label: 'Layout validado' },
  { key: 'pilar4_item_4', label: 'Endereços revisados' },
  { key: 'pilar4_item_5', label: 'Excesso conferido' },
  { key: 'pilar4_item_6', label: 'Produtos fora do local corrigidos' },
  { key: 'pilar4_item_7', label: 'Etiquetas conferidas' },
  { key: 'pilar4_item_8', label: 'Operadores definidos' },
  { key: 'pilar4_item_9', label: 'ERP atualizado' },
  { key: 'pilar4_item_10', label: 'Movimentações controladas' },
];

export interface KnowledgeEntry {
  title: string;
  body: string;
}

export const KNOWLEDGE_FAQ: KnowledgeEntry[] = [
  { title: 'O que é o Método I.B.®?', body: 'É a metodologia oficial InventoryBlind para ensinar empresas a construírem processos de estoque altamente confiáveis, estruturada em 7 Pilares.' },
  { title: 'Preciso concluir os cursos em ordem?', body: 'Sim. Cada curso de uma trilha só é liberado depois que o quiz do curso anterior é aprovado com nota mínima de 80%.' },
  { title: 'O certificado tem validade?', body: 'O certificado é emitido em PDF ao concluir 100% de uma trilha, com nome do colaborador, carga horária e data de emissão.' },
];

export const KNOWLEDGE_GLOSSARIO: KnowledgeEntry[] = [
  { title: 'Inventário Cego', body: 'Contagem realizada sem acesso ao saldo esperado do sistema, eliminando o viés de confirmação.' },
  { title: 'Divergência Real', body: 'Diferença entre o saldo contado e o saldo de sistema que persiste após recontagem e auditoria.' },
  { title: 'BlindScore', body: 'Pontuação de acuracidade e risco atribuída a cada operação de inventário.' },
];

export const KNOWLEDGE_BOAS_PRATICAS: KnowledgeEntry[] = [
  { title: 'Nunca conte no mesmo dia sem preparação', body: 'A preparação (Pilar 4) deve ocorrer nos dias anteriores à contagem, nunca no mesmo dia.' },
  { title: 'Separe produtos avariados imediatamente', body: 'Produtos avariados misturados aos saudáveis são uma das causas mais comuns de divergência silenciosa.' },
];

export const KNOWLEDGE_ARTIGOS: KnowledgeEntry[] = [
  { title: 'Por que organização reduz divergência antes da contagem', body: 'Um resumo de como a desorganização física do estoque é a origem da maioria das divergências encontradas em inventários.' },
];

export const KNOWLEDGE_ESTUDOS_CASO: KnowledgeEntry[] = [
  { title: 'Estudo de caso em breve', body: 'Casos reais de aplicação do Método I.B.® serão publicados aqui.' },
];
