# INVENTORYBLIND — Design Constitution (Visual DNA)

> Documento normativo. Não é uma lista de boas práticas de UI genéricas — é a
> fonte de verdade visual do InventoryBlind. Qualquer decisão de interface,
> tomada por qualquer pessoa ou por qualquer agente (incluindo Claude Code),
> deve poder ser justificada por este documento. Se uma decisão não está
> aqui, ela precisa ser adicionada aqui antes de virar padrão — nunca
> introduzida silenciosamente componente a componente.
>
> Esta tarefa foi **somente análise**. Nenhum arquivo de código do projeto
> foi alterado. Tudo descrito nas seções "Estado Atual" abaixo reflete o que
> já existe hoje no InventoryBlind, lido diretamente do código-fonte.

---

## 0. Como este documento foi construído

Este documento não inventa um design system do zero. Ele foi escrito depois
de uma inspeção real do projeto:

- **Stack**: Vite + React 18 + TypeScript, Tailwind CSS 3.4 (`darkMode:
  'class'`), Supabase como backend.
- **Sem biblioteca de UI de terceiros.** Não há shadcn/ui, Radix, MUI, Ant
  Design ou Chakra. Existe uma camada própria e pequena em
  `src/components/ui/` (`Button`, `Card`, `Panel`/`PanelSection`, `Badge`,
  `Modal`, `Table`, `Sidebar`, `AppHeader`, `PageHeader`, `ThemeToggle`).
- **Ícones**: `lucide-react` — família única, stroke único, sem mistura.
- **Animação**: `motion` (sucessor do Framer Motion) para microinterações da
  aplicação autenticada, e `gsap` + `@gsap/react` para sequências
  cinematográficas da Landing Page. Ambas já respeitam
  `prefers-reduced-motion` via `useAnimationTier`.
- **Tema**: claro/escuro via classe `.dark` + custom properties CSS
  (`--surface`, `--fg`, `--accent`, etc.), consumidas pelo Tailwind como
  `rgb(var(--token) / <alpha-value>)`.
- **Tipografia**: `tailwind.config.js` já declara `SF Pro Display` / `SF Pro
  Text` / `SF Mono` como primeira opção de cada stack, com fallback
  self-hosted (Geist) documentado em comentário — ver §6.
- Comentários no próprio código já usam a expressão **"Design System 2.0"**
  (`Card.tsx`, `tailwind.config.js`) — ou seja, o projeto já está em
  transição consciente para um sistema mais disciplinado. Este documento
  formaliza, nomeia e estende essa transição; não a substitui.

Onde o código atual já segue a filosofia que este documento define, isso é
declarado explicitamente como **"Estado Atual — conforme"**. Onde há
divergência (geralmente componentes mais antigos, pré-Design System 2.0),
isso é declarado como **"Estado Atual — a evoluir"**, sem prescrever a
correção agora. Esta tarefa não altera código.

---

## 1. Referência visual: Apple iOS/iPadOS 27 UI Kit

Referência: *iOS and iPadOS 27 (Community)*, Figma.

Ela deve ser lida como **princípios**, não como biblioteca de componentes a
clonar:

- hierarquia por tipografia e espaçamento antes de cor;
- materiais com função (vidro, translucidez, elevação) usados com moderação
  e propósito, nunca como acabamento padrão;
- controles precisos, discretos, com feedback claro de estado;
- densidade de informação alta sem parecer "carregado";
- silêncio visual — a interface não compete com o conteúdo.

O InventoryBlind **não é** um clone de app Apple. É um software profissional
de inventário/WMS. Onde o mundo Apple otimiza para consumo casual, o
InventoryBlind otimiza para operação repetida, de precisão, muitas vezes sob
pressão de tempo (conferência, contagem cega, picking). A referência empresta
disciplina visual, não personalidade de produto.

---

## 2. Objetivo do Design System

O InventoryBlind deve parecer: premium, profissional, preciso, técnico,
confiável, sofisticado, silencioso, proprietário, extremamente bem
projetado.

O InventoryBlind **não** deve parecer: template SaaS, dashboard genérico,
ferramenta de IA, interface gerada automaticamente, clone de admin panel,
landing page tecnológica, "AI dashboard".

### Princípio Visual Central

> **InventoryBlind não precisa parecer mais moderno. Precisa parecer mais
> bem projetado.**
>
> **Minimalismo funcional > decoração.**
>
> **Se um efeito não melhora compreensão, hierarquia, navegação, feedback ou
> acessibilidade, ele provavelmente não deve existir.**

Todas as seções abaixo são aplicações concretas desses três princípios.

---

## 3. ANTI-AI VISUAL RULES

Lista explícita do que é proibido ou fortemente desencorajado em qualquer
tela nova, componente novo ou revisão visual do InventoryBlind:

- gradientes decorativos (em fundo, em botão, em card);
- gradiente em texto (`bg-clip-text` estilo "AI startup");
- gradientes purple/blue característicos de produto de IA;
- glow / neon / sombra colorida;
- glassmorphism aplicado indiscriminadamente (blur em tudo);
- blur sem função (blur decorativo de fundo, "aurora" abstrata);
- cards gigantes com muito espaço vazio interno só para "parecer premium";
- excesso de cards — quando a página inteira é uma grade de caixas;
- card dentro de card (e pior, card dentro de card dentro de card);
- excesso de pills (tudo com `rounded-full`, inclusive onde não é status);
- border-radius exagerado em containers estruturais;
- ícones gigantes como elemento decorativo de página;
- ícone dentro de círculo colorido "porque fica bonito", sem função;
- excesso de badges — badge em todo campo, mesmo sem status real;
- excesso de cores — paleta usada por variedade, não por significado;
- excesso de elementos flutuantes (FAB, tooltips permanentes, chips soltos);
- números gigantescos sem contexto (KPI só com valor, sem label/trend);
- animação decorativa sem propósito comunicativo;
- bounce, elastic, overshoot exagerado;
- efeitos "chamativos" (confetti, sparkle, partícula fora da Landing);
- background abstrato tipo blob/mesh gradient nas telas operacionais;
- "AI sparkles" (ícone de estrelinha/varinha mágica como enfeite de UI);
- emoji como elemento de interface (emoji em texto de usuário é diferente
  e está fora de escopo);
- visual cyber/tech (grid neon, scanline, terminal fake);
- visual futurista genérico sem relação com o domínio (WMS/inventário);
- estética de template SaaS (hero gigante, ícone-em-círculo + título +
  descrição repetido em grid de 3, testemunhais fake).

**Regra fundamental:** a sofisticação da interface vem de tipografia +
espaçamento + hierarquia + composição + consistência — nunca da quantidade
de efeitos aplicados.

> Observação de estado atual: o código já não apresenta gradientes
> decorativos, glow, glassmorphism excessivo ou "AI sparkles" nas telas
> operacionais inspecionadas (`FullDashboard`, `ProductivityCards`,
> `HeatmapLegend`, badges de risco/classificação). O único lugar com
> linguagem mais expressiva é a Landing Page (`GlitterWrap`, GSAP), que é
> tratada como zona separada — ver §8 e §21.

---

## 4. Typography System

### 4.1 Fonte

Fonte principal desejada: **SF Pro**.

- **SF Pro Display** → display, títulos, headings, números grandes, KPIs,
  títulos de página.
- **SF Pro Text** → corpo, tabelas, menus, labels, inputs, buttons,
  descrições, navegação.

### Estado Atual — conforme

`tailwind.config.js` já declara exatamente essa separação:

```js
sans: ['SF Pro Text', 'Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
display: ['SF Pro Display', 'Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
mono: ['SF Mono', 'Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
```

Ou seja: o compromisso com SF Pro já está no código, na frente da fila de
cada stack. Nenhuma licença de fonte está instalada hoje — por isso a
segunda opção de cada stack é a estratégia de fallback (§4.4), não uma
substituição definitiva.

### 4.2 Escala tipográfica

Hierarquia coerente para o InventoryBlind, mapeada aos papéis do iOS
(Display, Large Title, Title 1/2/3, Headline, Body, Callout, Subheadline,
Footnote, Caption) e às classes utilitárias já existentes em
`src/index.css`:

| Papel (referência iOS) | Uso no InventoryBlind | Classe/token existente | Peso |
|---|---|---|---|
| Display / Large Title | Números de KPI, valor central de um card, título de seção muito grande | `.text-display` (`font-display text-3xl font-semibold tracking-tight`) | Semibold |
| Title 1 | Título de página | `.text-title` (`font-display text-xl font-semibold tracking-tight`) — mesmo papel usado hoje em `PageHeader` (`text-xl font-semibold`) | Semibold |
| Title 2 / Title 3 | Título de seção dentro da página, cabeçalho de Panel | `.text-headline` (`font-display text-base font-semibold`) | Semibold |
| Headline | Rótulo de grupo, cabeçalho de tabela em destaque | `.text-headline` ou `text-sm font-semibold` conforme densidade | Semibold |
| Body | Texto corrido, conteúdo de célula, descrição | `.text-body` (`text-sm`, `font-sans`) | Regular/Medium |
| Callout / Subheadline | Texto secundário de apoio a um valor (ex.: "Top: Mercado Livre") | `text-fg-muted text-sm`/`text-xs` | Regular |
| Footnote | Legendas de ajuda, helper text de formulário | `.text-caption` (`text-xs text-fg-subtle`) | Regular |
| Caption | Rótulo de seção em maiúsculas, cabeçalho de tabela | `.text-section` (`text-xs font-semibold uppercase tracking-wide text-fg-subtle`) | Semibold |
| Numérico (transversal) | Valores de KPI, IDs, quantidades, timestamps, colunas de tabela numéricas | `.text-numeric` (`font-mono tabular-nums`) | — |

Regra: **nenhum valor arbitrário novo**. Um novo componente reutiliza uma
das classes acima. Se nenhuma servir, a decisão de criar uma nova classe é
uma decisão de Design System (§25), não uma decisão de componente isolado.

`.text-numeric` existe porque KPIs, IDs e colunas de tabela precisam de
algarismos alinhados (`tabular-nums`) e de um registro visual "de
instrumento de precisão" — não da mesma fonte proporcional usada em prosa.
Isso é deliberado e deve continuar: números operacionais não usam a fonte
display comum, usam mono.

### 4.3 Fontes proibidas como padrão

Não devem ser introduzidas como fonte principal do produto: **Inter,
Poppins, Roboto, Montserrat, Arial**, ou qualquer fonte genérica de
dashboard. Uma dessas fontes aparecendo em um componente novo é, por
definição, drift (§25) e deve ser sinalizado antes de mesclar.

### 4.4 Estratégia de fallback (SF Pro ausente em produção)

SF Pro não é distribuída livremente e não deve ser "baixada de qualquer
lugar" para servir via `@font-face` — isso tem implicação de licenciamento
que este documento não resolve. Enquanto não houver arquivos licenciados:

1. O fallback ativo hoje é **Geist** (self-hosted, OFL, variável — já
   carregada via `@font-face` em `src/index.css` como `Geist Sans` /
   `Geist Mono`). Geist foi escolhida porque lê no mesmo registro
   preciso/técnico do SF Pro, em qualquer SO — diferente do stack anterior
   baseado em `-apple-system`, que caía para Segoe UI puro no Windows e
   perdia esse caráter.
2. Depois de Geist, o stack cai para `-apple-system` / `BlinkMacSystemFont`
   (pega SF Pro nativamente em macOS/iOS sem precisar embutir nada) e só
   então para `Segoe UI` / `sans-serif`.
3. Quando SF Pro licenciada estiver disponível, ela entra **na frente** do
   stack sem precisar reescrever nenhum componente — é só adicionar o
   `@font-face` com `font-family: 'SF Pro Text'` / `'SF Pro Display'`. O
   `tailwind.config.js` já está preparado para essa troca ser transparente.

Esta seção documenta a estratégia; **não implementa nenhuma mudança agora.**

---

## 5. Color System

A cor tem função. Nunca é usada apenas como decoração ou para "dar
variedade" a uma tela.

### 5.1 Categorias

| Categoria | Papel | Token existente (app autenticado) |
|---|---|---|
| Background | Fundo da aplicação, por trás de tudo | `--surface` (via classe `bg-surface`) |
| Surface | Superfície de conteúdo padrão (Card, Panel) | `--surface-2` (`bg-surface-2`) |
| Elevated Surface | Superfície acima da superfície padrão (dropdown, popover, toggle ativo) | `--surface-3` (`bg-surface-3`) |
| Primary Text | Texto principal | `--fg` |
| Secondary Text | Texto de apoio, labels | `--fg-muted` |
| Tertiary Text | Texto de menor prioridade, placeholders, ícones inertes | `--fg-subtle` |
| Separator | Linha divisória entre blocos, borda de Card/Panel/Table | `--edge` |
| Accent | Ação primária, item ativo, foco | `--accent` / `--accent-strong` (hover/pressed) |
| Success | Estado saudável, aprovado, concluído | `emerald-500/600` (semântico, não é token de tema — ver nota) |
| Warning | Atenção, divergência moderada | `amber-500/600` |
| Error | Crítico, falha, destrutivo | `red-500/600` |
| Info | Neutro informativo (raramente distinto de accent) | `--accent` com peso reduzido, ou `sky`/`blue` quando precisar se diferenciar de "ação" |
| Disabled | Elemento inativo | `opacity-50` sobre o token base, nunca uma cor nova |

Nota sobre Success/Warning/Error: hoje são utilizados diretamente como
utilitários Tailwind (`emerald-`, `amber-`, `red-`) dentro de `Badge.tsx`,
não como custom properties de tema — e isso é aceitável, porque são cores
**semânticas fixas** (o "vermelho de erro" não deveria mudar com o tema, ao
contrário do "azul de marca" que sim precisa reagir a light/dark via
`--accent`). Não promover Success/Warning/Error a custom property só por
consistência estética; isso é uma decisão arquitetural deliberada, não uma
lacuna a corrigir.

### 5.2 Dois mundos de cor, por design

O InventoryBlind tem **duas paletas coexistindo intencionalmente**, e isso
não é inconsistência — é separação de contexto:

1. **App autenticado** (dashboard, contagem, picking, auditoria, etc.):
   tokens semânticos reativos a tema (`surface`/`fg`/`edge`/`accent`),
   resolvidos via custom properties em `:root` e `.dark`.
2. **Landing Page e `AuthPage`**: paleta fixa `ink` / `mist` / `enterprise`
   (definida em `tailwind.config.js`), que **não reage** à classe `.dark` e
   não referencia os tokens semânticos. Essa é a identidade visual "de
   marca" do InventoryBlind voltada para fora; o app autenticado é a
   ferramenta de trabalho voltada para dentro. Um novo componente de
   Landing não deve importar tokens semânticos do app, e vice-versa.

### 5.3 Light Mode / Dark Mode

- Dark mode não é "light mode invertido" — os valores de `--surface-2`
  (18 21 28) e `--edge` (42 47 59) no dark são deliberadamente próximos dos
  valores fixos `ink-900`/`ink-700` da Landing, para que a identidade visual
  do produto autenticado *seja* a identidade da Homepage em modo escuro, não
  uma paleta neutra genérica de dashboard.
- Ambos os modos compartilham a mesma escala de contraste relativo entre
  `surface` → `surface-2` → `surface-3` → `edge`: cada passo é um degrau de
  elevação sutil, nunca um salto de tom.

### 5.4 Estados de interação

- **hover**: um passo de superfície acima (`surface-2` → `surface-3`) ou
  leve mudança de texto (`fg-muted` → `fg`). Nunca introduz cor nova.
- **active/pressed**: `accent` → `accent-strong`; ou, em botões,
  `whileTap={{ scale: 0.97 }}` (já implementado via `motion` em
  `Button.tsx`) — feedback de pressão é escala, não cor extra.
- **focus**: anel de foco visível, `focus:ring-2 focus:ring-accent/40` —
  nunca remover o outline sem substituí-lo por algo igualmente visível.
- **disabled**: `opacity-50` + `pointer-events-none` sobre o próprio
  componente, nunca uma paleta "cinza de desabilitado" separada.

---

## 6. Surface System

Camadas de superfície, do fundo para o topo:

`background` → `surface` → `elevated surface` → `overlay` → `contextual
surface`.

- **Background** (`--surface`): o chão da aplicação.
- **Surface** (`--surface-2`): onde o conteúdo vive — Card, Panel, tabela.
- **Elevated Surface** (`--surface-3`): um nível acima, para elementos que
  precisam se destacar sutilmente da superfície ao redor sem virar um card
  novo — hover de linha de tabela, fundo de input, toggle de view mode ativo.
- **Overlay**: modais e drawers (`shadow-overlay`, ver §12), sempre com
  backdrop (`bg-black/50 backdrop-blur-sm`) para desconectar do conteúdo por
  trás.
- **Contextual surface**: superfícies que só existem enquanto uma ação está
  ativa — dropdown, popover, tooltip. Usam `z-popover`/`z-dropdown` (já
  definidos em `src/index.css`) e normalmente `surface-3` ou `surface` com
  `shadow-overlay`.

### Quando usar o quê

- **background vs. border**: use borda (`border-edge`) para separar dois
  blocos de conteúdo relacionado; use uma nova camada de superfície apenas
  quando o conteúdo precisa parecer *fisicamente distinto* do que está
  atrás (modal, popover) — não como reforço estético de algo que a borda já
  resolveria.
- **separador vs. elevação**: dentro de um Panel, use `PanelSection`
  (borda superior, `border-t border-edge`) para dividir sub-blocos — nunca
  crie um Card novo dentro do Panel para isso (ver §9).
- **translucidez/blur**: reservado a backdrop de modal e, com critério, a
  header sticky sobre conteúdo em scroll rápido. Nunca em Card, Sidebar
  completa, tabela ou input.

### Liquid Glass

A referência iOS/iPadOS 27 tem "Liquid Glass" como material. No
InventoryBlind:

> **Liquid Glass é uma referência de material, não um efeito obrigatório.**

Proibido aplicar indiscriminadamente em: todos os cards, sidebar inteira,
tabelas, inputs, buttons. Usar **somente** quando houver função real —
por exemplo, um backdrop de modal que precisa desconectar visualmente do
conteúdo atrás, ou um header sticky sobre uma tabela em scroll rápido que
precisa continuar legível. Fora desses casos, uma superfície sólida com
borda quieta (o padrão atual de `Card`/`Panel`) é a escolha correta — e é a
que já está implementada.

---

## 7. CARD PHILOSOPHY

> **Nem todo conteúdo precisa estar dentro de um card.**

Cards existem para: agrupar informação, separar contexto, estabelecer
hierarquia, representar uma unidade funcional. Um card que não faz nenhuma
dessas quatro coisas é decoração, e decoração é o que este documento existe
para eliminar.

### Estado Atual — conforme

`Card.tsx` já documenta essa filosofia no próprio código:

> *"Flat by default (border only, no shadow) — Design System 2.0 favors
> quiet borders over drop shadows so surfaces don't compete for
> attention."*

E `Panel`/`PanelSection` já resolvem exatamente o problema de "card dentro
de card": ao invés de aninhar um `Card` dentro de outro `Card` para separar
sub-blocos (ex.: os quatro KPIs do `FullDashboard`, ou o cabeçalho de uma
lista seguido da lista), o padrão correto — e já em uso — é **um** `Panel`
com múltiplas `PanelSection` separadas por `border-t`. Isso lê como um bloco
único com divisões internas, não como uma pilha de caixas.

Evitar, em qualquer card novo:

- card dentro de card (e nunca card dentro de card dentro de card);
- sombras fortes (a escala de sombra do projeto é deliberadamente quase
  inexistente — ver §12);
- gradientes;
- ícones decorativos sem função (um ícone dentro de um card deve ilustrar o
  que o card *é*, não preenchê-lo);
- excesso de padding (`Card`/`Panel` já expõem `padding: 'none' | 'sm' |
  'md' | 'lg'` — usar a menor opção que ainda respira, não sempre `lg`);
- excesso de radius (usar `rounded-container`, nunca um valor maior "porque
  parece mais moderno").

### Diretrizes por tipo

- **KPI Card**: ver §19 (KPI System) — estrutura Label → Value → Context →
  Trend, sem ícone gigante nem círculo colorido.
- **Content Card**: o padrão default de `Card`/`Panel` — bloco com borda +
  `surface-2`, sem sombra.
- **Action Card**: um Content Card cujo conteúdo principal é um CTA
  (ex.: "Criar novo agendamento"). O card não deve ficar mais decorado só
  porque contém um botão — o botão já carrega a hierarquia (§16).
- **Information Card**: texto informativo/contextual, tipicamente com um
  ícone pequeno (`Info`, 12–14px) ao lado de um rótulo em `.text-section`,
  como em `HeatmapLegend.tsx` hoje.
- **Warning Card**: usa o token `warning` (âmbar) só na borda/ícone/badge
  interno, não como fundo sólido do card inteiro — o card continua
  `surface-2` + `border-edge`; a cor de atenção é pontual, não um banner
  colorido.
- **Empty State Card**: ícone único em baixa ênfase (`opacity-40`,
  ~32px), uma frase curta, uma frase de apoio opcional — exatamente o
  padrão já usado no estado vazio de `FullDashboard.tsx`
  (`<LayoutDashboard size={32} className="mb-2 opacity-40" />` + duas
  linhas de texto). Sem ilustração, sem card extra em volta do ícone.

---

## 8. Spacing System

Escala global de espaçamento — o ritmo é o que faz a interface parecer
projetada, não decorada. O projeto já opera dentro da escala padrão do
Tailwind (múltiplos de 0.25rem/4px); a disciplina está em **qual passo usar
onde**, de forma consistente:

| Contexto | Valor padrão | Observação |
|---|---|---|
| Page padding (horizontal, AppHeader/conteúdo) | `px-4` mobile → `px-7` desktop | Já em uso em `AppHeader.tsx` |
| Section spacing (entre blocos verticais de uma página) | `space-y-6` | Já em uso (`FullDashboard.tsx`) |
| Component spacing (entre itens relacionados, ex. botões de ação) | `gap-2` a `gap-3` | |
| Internal padding — Card/Panel pequeno | `p-4` (`padding="sm"`) | |
| Internal padding — Card/Panel padrão | `p-5` (`padding="md"`) | Default do componente |
| Internal padding — Card/Panel grande (KPI strip, hero interno) | `p-7` (`padding="lg"`) | |
| Table — célula | `px-4 py-2.5` (header) / `px-4 py-3` (linha) | |
| Form — entre campos | `gap-3`/`gap-4` conforme densidade do formulário | |
| Form — padding interno de input/select | `px-3 py-2` a `px-4 py-2.5` | |

Regra: ao criar um componente novo, primeiro procurar se o espaçamento já
existe em um componente irmão (mesma família: outro Card, outro item de
formulário, outra linha de tabela) e reaproveitar o valor — não redescobrir
o número.

---

## 9. Corner Radius System

Nunca "tudo é uma bolha". A escala diferencia por *tipo de elemento*, não
por gosto:

### Estado Atual — conforme

`tailwind.config.js` já define a escala semântica (comentário original:
*"Explicit scale instead of one flat radius reused for every concern"*):

| Token | Valor | Uso |
|---|---|---|
| `rounded-control` | `0.625rem` (10px) | Botões, inputs, controles pequenos |
| `rounded-container` | `0.75rem` (12px) | Cards, Panels |
| `rounded-sheet` | `1.25rem` (20px) | Modais, drawers, bottom sheets |
| `rounded-full` | — | **Somente** pills reais: Badge, toggle de view mode, indicador de status (dot) |

### Estado Atual — a evoluir

Componentes anteriores ao Design System 2.0 (ex.: `HeatmapFilters.tsx`)
ainda usam `rounded-lg`/`rounded-md` genéricos do Tailwind em vez dos tokens
semânticos acima. Isso não deve ser "corrigido em massa" agora (fora de
escopo desta tarefa e do princípio de estabilidade) — mas todo componente
**novo** deve usar `control`/`container`/`sheet`, nunca reintroduzir
`rounded-lg` solto como se fosse um valor novo e independente.

Popovers/dropdowns seguem o mesmo radius de `control` quando pequenos
(menu de ação) ou `container` quando maiores (painel de filtros flutuante).

---

## 10. Shadow System

Escala extremamente limitada, em ordem de prioridade — sempre prefira a
opção mais alta na lista antes de descer:

1. **sem sombra** (padrão absoluto — a maioria das superfícies não precisa
   de nenhuma);
2. **border/separator** (`border-edge`) — resolve 90% dos casos de "preciso
   separar isso visualmente";
3. **surface contrast** (`surface-2` sobre `surface`, `surface-3` sobre
   `surface-2`) — resolve elevação sem sombra nenhuma;
4. **sombra sutil** — `shadow-control` (`0 1px 2px rgb(0 0 0 / 0.04)`) ou
   `shadow-panel`, já definidas em `tailwind.config.js`, para o raro caso em
   que borda + contraste de superfície não bastam;
5. **sombra contextual** — `shadow-overlay` (`0 16px 40px -12px rgb(0 0 0 /
   0.22), 0 4px 12px -4px rgb(0 0 0 / 0.08)`), reservada a elementos que
   literalmente flutuam sobre o resto da tela: modal, drawer, popover.

Proibido: glow, sombra colorida, `shadow-lg`/`shadow-xl`/`shadow-2xl`
genéricos do Tailwind aplicados "porque destaca", múltiplas sombras
empilhadas sem necessidade.

Este é, de longe, o item onde o código atual já está mais alinhado com a
filosofia deste documento: os três únicos tokens de sombra do projeto
(`control`, `panel`, `overlay`) já seguem exatamente esta escala, e o
comentário original em `tailwind.config.js` já diz *"most surfaces should
need none of these at all"*.

---

## 11. Iconography

### Estado Atual — conforme

Família única: `lucide-react`. Stroke único, tamanhos consistentes por
contexto (14–16px em texto/labels, 17–18px em navegação/sidebar, 32px no
máximo em empty states). Nenhum emoji, ícone 3D, ícone multicolorido ou
mistura de famílias foi encontrado nos componentes inspecionados.

Regras a manter:

- um ícone de ação (botão, item de menu) tem exatamente uma cor: a cor do
  texto ao redor (`text-fg-muted`, `text-accent`, etc.) — nunca uma cor
  própria fixa;
- ícone de status (dot, indicador) pode ter cor semântica própria
  (`bg-emerald-500`, etc.), porque *é* o dado, não decoração do dado;
- tamanho de ícone é function do contexto (dentro de um botão `sm` vs.
  `md`, dentro de uma linha de tabela, dentro de um item de sidebar) — nunca
  arbitrário por componente;
- nunca envolver um ícone funcional em um círculo colorido "para destacar"
  sem que a cor do círculo already carregue um significado semântico (ex.:
  círculo verde = status saudável é válido; círculo azul decorativo atrás
  de um ícone de "configurações" não é).

### Como deve evoluir

Conforme o produto cresce, qualquer ícone novo entra pela mesma família
(`lucide-react`) e pelos mesmos tamanhos-padrão acima. Se um dia for
necessário um ícone customizado (ex.: um pictograma específico de WMS que
Lucide não tem), ele deve ser desenhado no mesmo peso de linha (stroke
~1.5–2px em viewBox 24) para não introduzir uma segunda linguagem visual —
essa é uma decisão de Design System (§25), não uma decisão pontual de
componente.

---

## 12. Sidebar

Inspiração: navegação iPadOS/macOS (painel lateral com grupos colapsáveis,
item ativo tintado, densidade alta sem parecer apertado) — sem copiar
literalmente.

### Estado Atual — conforme

`Sidebar.tsx` já implementa:

- **grupos em acordeão**: apenas um grupo aberto por vez; o grupo que
  contém o item ativo abre automaticamente e permanece aberto durante a
  navegação dentro dele;
- **item ativo**: fundo tintado (`bg-accent/10 text-accent`), **sem
  borda** — nunca uma barra lateral colorida ou fundo sólido de cor de
  marca. Isso é deliberado: tinta > borda > preenchimento sólido, na
  hierarquia de ênfase;
- **hover**: `hover:bg-surface-3`, mesmo padrão de elevação sutil usado em
  qualquer outro lugar da app;
- **ícones**: tamanho fixo (17px), peso único, sem cor própria (herdam a
  cor do texto do item);
- **labels**: truncados (`truncate`) em vez de quebrar linha ou empurrar
  layout;
- **collapsed state**: 76px de largura, apenas ícones centralizados,
  tooltip com o label no `title` do botão;
- **locked / "coming soon"**: item ou grupo inteiro não-interativo, opacidade
  reduzida, ícone de cadeado, tooltip explicativo — nunca escondido, nunca
  removido, apenas comunicado como indisponível;
- **mobile**: a sidebar completa não aparece; `AppHeader` expõe um botão de
  menu (`onOpenMobileNav`) que abre a navegação em overlay — mobile não é
  "sidebar encolhida", é um padrão de navegação próprio (fora do escopo
  desta tarefa detalhar o drawer mobile, que vive em `App.tsx`).

Nenhuma alteração é proposta aqui — este comportamento já é o padrão a ser
preservado e reutilizado por qualquer navegação nova.

---

## 13. Header

`AppHeader.tsx` já define o padrão:

- **altura**: `h-16` fixo (mais o safe-area-inset-top em PWA/iOS);
- **densidade**: uma única linha — contexto de página à esquerda, ações de
  tema/usuário à direita. Nenhuma segunda linha de navegação duplicada (a
  navegação primária vive só na Sidebar);
- **espaçamento**: `px-4` mobile → `px-7` desktop, `gap-3` entre elementos;
- **hierarquia**: o slot esquerdo (`left`) carrega o que orienta o usuário
  (título de contexto, breadcrumb leve); o slot direito (`right`) carrega
  controles globais (tema, usuário) — nunca ações de página específicas,
  que pertencem ao `PageHeader` dentro do conteúdo;
- **responsividade**: botão de menu mobile (`Menu`, 18px) aparece apenas
  `md:hidden`, alinhado à esquerda antes do conteúdo;
- **borda**: `border-b border-edge/70` — separador quieto, sem sombra
  abaixo do header.

Evitar: adicionar um segundo brand mark, duplicar navegação que já existe
na Sidebar, ou aumentar a altura para acomodar decoração.

---

## 14. Button System

### Estado Atual — conforme

`Button.tsx` já define 4 variantes e 2 tamanhos:

| Variante | Uso | Estilo |
|---|---|---|
| `primary` | Ação principal da tela/seção | `bg-accent hover:bg-accent-strong text-white shadow-sm` |
| `secondary` | Ação alternativa, igualmente válida mas não a principal | `bg-surface-3 hover:bg-edge text-fg border border-edge` |
| `ghost` | Ação de baixa ênfase (ex.: "cancelar", ícone de utilidade) | `bg-transparent hover:bg-surface-3 text-fg-muted hover:text-fg` |
| `danger` | Ação destrutiva | `bg-red-600 hover:bg-red-500 text-white` |

Tamanhos: `sm` (`px-3 py-1.5 text-xs`) e `md` (`px-4 py-2.5 text-sm`,
default). Radius: `rounded-control` (não pill — ver §9). Tipografia:
`font-semibold`. Estados: `disabled:opacity-50 disabled:pointer-events-none`;
pressão dá feedback por escala (`whileTap={{ scale: 0.97 }}` via `motion`),
não por mudança de cor adicional. Ícone e texto usam `gap-2`.

Regra a preservar: **nem todo botão é pill.** O botão do InventoryBlind é
`rounded-control` — a mesma família visual de um input, não a de um badge.
Transformar botões em pill (`rounded-full`) descaracterizaria essa
distinção e é exatamente o tipo de drift que §25 proíbe.

**Icon Button**: mesmo padrão de `Button`, sem label visível, sempre com
`aria-label`/`title` (ver `ThemeToggle.tsx` como referência: quadrado
`w-8 h-8`, `rounded-lg`, ícone 16px, cor herdada de `text-fg-muted`).

---

## 15. Form System

### Estado Atual — a evoluir (mas já consistente)

Não existe ainda um componente `Input`/`Select` compartilhado em
`src/components/ui/` — cada tela declara seu próprio `<input>`/`<select>`.
Isso é uma lacuna real (drift potencial), mas o padrão visual que essas
telas seguem hoje já é internamente consistente (ex.: `HeatmapFilters.tsx`):

- fundo `bg-surface-3`, borda `border-edge`;
- foco: `focus:outline-none focus:ring-2 focus:ring-accent/40`
  (opcionalmente `focus:border-transparent`);
- placeholder em `placeholder-fg-subtle`;
- padding `px-3 py-2` a `px-4 py-2.5` conforme densidade;
- ícone de contexto (busca, filtro) posicionado absoluto dentro do campo,
  cor `text-fg-subtle`.

Diretriz para quando um `Input`/`Select`/`Textarea`/`Checkbox`/`Radio`/
`Switch`/`DatePicker` compartilhado for extraído para `ui/` (trabalho de
implementação, fora desta tarefa):

| Elemento | Padrão |
|---|---|
| Label | `.text-label` acima do campo, nunca só placeholder como label |
| Placeholder | `text-fg-subtle`, nunca a única fonte de instrução do campo |
| Helper | `.text-caption` abaixo do campo |
| Error | mesma posição do helper, cor `text-red-600 dark:text-red-400`, substitui (não soma a) o helper |
| Disabled | `opacity-50`, cursor `not-allowed`, sem remover a borda |
| Focus | anel `ring-accent/40`, sempre visível — nunca `outline-none` sem substituto |
| Active/preenchido | sem estilo especial além do valor digitado — o campo não "celebra" ter conteúdo |
| Radius | `rounded-control`, igual a botões |

**Filtros** (`HeatmapFilters.tsx` é a referência viva): busca com ícone +
botão de limpar inline; toggles de view mode como grupo de pills dentro de
uma cápsula `bg-surface-3 p-1 rounded-lg`; filtros por criticidade como
pills coloridas **apenas** quando a cor já é semântica (dot de status) —
não decorativas.

---

## 16. Table System

Tabelas são componentes críticos no InventoryBlind — é onde a maior parte
da decisão operacional acontece (contagem, conferência, produtividade).

### Estado Atual — conforme

`Table.tsx` já define o padrão mínimo e correto:

- **density**: compacta por padrão — `text-sm`, células `px-4 py-2.5`
  (header) / `px-4 py-3` (linha);
- **header**: `bg-surface-3`, texto `text-fg-muted text-xs uppercase
  tracking-wide font-medium` — mesmo registro de `.text-section`;
- **linhas**: separador `border-b border-edge/60`, última linha sem borda
  (`last:border-0`);
- **hover**: `hover:bg-surface-3/40`, transição suave — nunca sombra ou
  elevação de linha;
- **numeric alignment**: valores numéricos usam `.text-numeric`
  (mono + `tabular-nums`) para alinhar algarismos entre linhas — crítico em
  colunas de quantidade/SKU/valor;
- **status**: representado por `Badge` (§17) dentro da célula, nunca por
  colorir a linha inteira ou a célula inteira;
- **responsive**: `.table-scroll-container`/`.table-container-mobile`
  (definidos em `src/index.css`) — scroll horizontal dentro do próprio
  container em telas estreitas, com `-webkit-overflow-scrolling: touch`.

**Regra fundamental a preservar:** cada linha é uma linha de tabela — nunca
um card. Transformar linhas em cards em mobile (padrão comum em UI
genérica) quebraria a leitura tabular que o operador precisa para
conferência rápida. Se o mobile precisar de outra representação, ela deve
ser uma lista densa com a mesma hierarquia de colunas, não uma grade de
cartões.

**Sorting/filtering**: cabeçalho clicável com indicador de direção
(`SortAsc`/`SortDesc`, 16px, `text-fg-muted`) ao lado do label — mesmo
padrão já usado em `HeatmapFilters.tsx` para o controle de ordenação global
da página.

---

## 17. KPI System

Estrutura preferencial, já em uso em `FullDashboard.tsx` e
`ProductivityCards.tsx`:

```
LABEL     → .text-section (uppercase, pequeno, fg-subtle) + ícone 14px opcional
VALUE     → .text-display ou text-lg font-semibold (fg, ou cor semântica se o valor for bom/mau)
CONTEXT   → .text-caption (ex.: "Top: Mercado Livre")
TREND     → variação percentual/seta, mesma hierarquia do context, cor semântica só quando há direção real
```

Vários KPIs relacionados vivem **dentro do mesmo Panel**, divididos por
`divide-x`/`divide-y` (grid com divisores), não em cards individuais — é
assim que `FullDashboard.tsx` já implementa a faixa de 4 KPIs no topo da
tela.

Proibido, e já ausente do código inspecionado: **ícone gigante + círculo
colorido + número gigantesco + badge + gradiente** no mesmo componente. Um
KPI é dado, não um anúncio.

---

## 18. Badges

Badges existem para: status, classificação, risco, estado, categoria — ou
seja, para carregar um dado semântico curto. Nunca para decoração.

### Estado Atual — conforme

`Badge.tsx` define 5 variantes (`neutral`, `accent`, `success`, `warning`,
`danger`), todas em `rounded-full`, `text-xs font-medium`, cor de fundo em
baixa opacidade (`/10`) + texto na cor cheia. O próprio comentário do
componente já declara a regra: *"success/warning/danger são semânticos
(significado real), nunca usados decorativamente."* Os badges derivados
(`RiskBadge`, `ClassificationBadge`, `ConfidenceBadge`) seguem
exatamente esse contrato — cada um mapeia um enum de domínio (nível de
risco, combinação ABC/XYZ, nível de confiança) para uma das 5 variantes,
nunca escolhendo cor livremente.

Regra a preservar: um badge novo deve mapear um valor de domínio real para
uma variante existente. Se o valor não cabe em `neutral/accent/success/
warning/danger`, a pergunta certa é "esse dado deveria ser um badge?" antes
de "que cor eu uso?".

---

## 19. Motion System

O InventoryBlind usa duas bibliotecas de animação, cada uma com um papel
diferente — e isso já está corretamente separado no código:

- **`motion`** (Motion/Framer): microinterações da aplicação autenticada —
  feedback de tap em botão, entrada/saída de modal, transição de altura em
  acordeão. Curto, funcional, quase invisível.
- **`gsap` + `@gsap/react`**: sequências mais longas e coreografadas,
  hoje usadas **apenas na Landing Page** (`Hero.tsx`, `HeroAnimation.tsx`,
  `landingScroll.ts` com `ScrollTrigger`) — entrada de texto com
  `SplitText`, parallax de scroll, o efeito de partículas `GlitterWrap`.

### Princípios

> Motion deve: comunicar, orientar, confirmar, contextualizar.
> Motion não deve: decorar, impressionar, distrair.

| Contexto | Duração | Easing | Comportamento |
|---|---|---|---|
| Hover (app) | instantâneo (`transition-colors`, ~150ms padrão Tailwind) | linear/ease padrão do browser | mudança de cor de superfície/texto apenas |
| Tap/press (botão) | ~100–150ms | spring implícito do `motion` | `scale: 0.97` — nunca bounce visível |
| Modal enter/exit | 200ms | ease padrão (`motion` default) | `opacity` + `scale: 0.96→1` + `y: 8→0`, já implementado em `Modal.tsx` |
| Sidebar (expandir/colapsar grupo) | 200–300ms | `ease-in-out` | `grid-template-rows` de `0fr`→`1fr`, já implementado em `Sidebar.tsx` |
| Page transition (app autenticado) | mínimo ou nenhum | — | o app prioriza troca instantânea de conteúdo — não é a Landing |
| Entrance (Landing, GSAP) | 0.35–1.6s dependendo do elemento | `power2.out`/`power2.inOut` | coreografado, um único "momento" por seção, nunca repetido em loop |
| Scroll-linked (Landing, GSAP `ScrollTrigger`) | `scrub` contínuo, não por duração fixa | linear ao progresso do scroll | desaceleração/fade ao saÍr da seção — já implementado em `useHeroAnimation` |

### Acessibilidade de movimento

`useAnimationTier()` já resolve isso corretamente e deve continuar sendo o
único mecanismo de decisão: `full` (desktop, sem preferência de redução) →
`simplified` (mobile/tablet, `max-width: 1024px`) → `minimal`
(`prefers-reduced-motion: reduce`, **sempre vence** independentemente do
dispositivo). `GlitterWrap` já usa esse tier para reduzir contagem de
partículas (220 → 90 → 24) e desligar flashes/turbulência no tier mínimo, em
vez de simplesmente remover o componente — "reduzido, não removido", como o
próprio comentário do código já define.

**GSAP continua reservado a onde realmente faz sentido** — hoje, a Landing.
Não introduzir GSAP em telas operacionais (dashboard, tabelas, formulários)
para "dar mais vida": lá, `motion` já é suficiente e mais apropriado ao
registro "silencioso" que essas telas devem ter.

---

## 20. Responsive Design

- **Desktop/laptop**: Sidebar expandida (`w-56`), AppHeader com todos os
  controles visíveis, tabelas em largura total.
- **Tablet** (769–1024px): Sidebar pode operar colapsada (`w-[76px]`);
  regra específica já existe em `src/index.css` para manter a navegação
  visível com wrap em vez de escondê-la.
- **Mobile** (≤768px): Sidebar sai do fluxo, substituída por navegação em
  overlay acionada pelo botão de menu do `AppHeader`; tabelas ganham scroll
  horizontal dedicado (`.table-container-mobile`); todo elemento interativo
  respeita mínimo de **44×44px** de touch target (regra global já em
  `src/index.css`); inputs usam `font-size: 16px` para não disparar zoom
  automático do iOS Safari.
- **PWA**: `safe-area-inset-*` já aplicado a header e áreas fixas;
  `100dvh` com fallback `100vh` via `@supports` para lidar com a barra de
  endereço do Safari em iOS.

Atenção especial (já coberta pelo CSS global, preservar):

- **sheets/dialogs**: em mobile, modais devem continuar utilizáveis dentro
  de `max-h-[90vh]` com scroll interno (`Modal.tsx` já faz isso) — nunca
  transbordar a viewport;
- **filtros**: em telas estreitas, a linha de filtros deve quebrar
  (`flex-wrap`) antes de forçar scroll horizontal na barra de filtros;
- **forms**: campos empilham verticalmente abaixo do breakpoint `sm`, sem
  reduzir padding abaixo do mínimo de toque.

---

## 21. Accessibility

- **Contraste**: os tokens de texto (`fg`/`fg-muted`/`fg-subtle`) já foram
  calibrados para manter leitura em ambos os temas — qualquer nova cor de
  texto deve ser testada contra `surface`/`surface-2` no light e no dark
  antes de entrar em uso.
- **Foco**: nunca `outline: none` sem um `ring` visível equivalente; o
  padrão `focus:ring-2 focus:ring-accent/40` já é a referência.
- **Teclado**: todo controle interativo (item de sidebar, linha clicável de
  tabela, botão de ação) deve ser alcançável e operável via teclado — itens
  `locked` da Sidebar já sinalizam corretamente via `disabled` em vez de
  apenas remover o `onClick`.
- **Touch targets**: mínimo 44×44px em mobile, já garantido globalmente.
- **Reduced motion**: `useAnimationTier()` é a via única e deve ser
  respeitada por qualquer animação nova, GSAP ou Motion.
- **Estados semânticos**: cor nunca é o único portador de significado —
  Badges combinam cor + texto (nunca só uma pastilha colorida sem label);
  o dot de status em `OpRow` sempre acompanha um `Badge` textual ao lado,
  nunca sozinho.
- **Tipografia legível**: tamanho mínimo de corpo `text-sm` (14px) em
  qualquer contexto de leitura prolongada; `text-xs` reservado a labels e
  metadados curtos, nunca a conteúdo principal.

---

## 22. Component Hierarchy

```text
Design Tokens        (cores rgb(var(--token)), radius control/container/sheet,
                       shadow control/panel/overlay, tipografia sans/display/mono)
    ↓
Foundation            (src/index.css: custom properties de tema, classes
                       tipográficas .text-*, z-index scale, safe-area, scroll)
    ↓
Primitives            (Button, Card, Panel/PanelSection, Badge, Modal, Table/
                       Thead/Tr/Th/Td — src/components/ui/)
    ↓
Components            (RiskBadge, ClassificationBadge, ConfidenceBadge,
                       ProductivityCards, HeatmapLegend — compõem Primitives
                       com dados de domínio)
    ↓
Patterns              (KPI strip, filtros de página, lista de operações
                       ativas — arranjos recorrentes de Components)
    ↓
Pages                 (FullDashboard, RiskDashboardPage, RcaDashboardPage,
                       AbcXyzDashboardPage — compõem Patterns)
```

Regra de consumo: uma **Page** nunca declara um token bruto (`rgb(...)`,
`0.75rem`) diretamente — ela usa **Patterns**/**Components**, que usam
**Primitives**, que usam **Foundation**, que usa **Design Tokens**. Se uma
Page precisa de uma cor ou espaçamento que nenhum nível abaixo oferece,
isso é sinal de que falta um token ou uma variante em um Primitive — não
uma licença para escrever o valor arbitrário direto na Page.

---

## 23. VISUAL CONSISTENCY / ANTI-DRIFT

Nenhum componente novo introduz, sem justificar e integrar formalmente a
este documento:

- nova fonte (fora do stack `sans`/`display`/`mono` já definido);
- novo radius (fora de `control`/`container`/`sheet`/`full`);
- nova sombra (fora de `control`/`panel`/`overlay`, ou "nenhuma");
- nova cor (fora de `surface*`/`fg*`/`edge`/`accent*` para o app, ou
  `ink`/`mist`/`enterprise` para Landing/Auth, ou as 4 cores semânticas
  fixas — emerald/amber/red/accent-azul);
- nova família de ícones (fora de `lucide-react`);
- novo estilo de botão (fora de `primary`/`secondary`/`ghost`/`danger`);
- novo padrão de card (fora de Content/KPI/Action/Information/Warning/
  Empty State, conforme §7).

Se uma tela nova parece "precisar" de algo fora dessa lista, a pergunta
correta não é "como eu implemento isso nesta tela", é "isso deveria virar
uma extensão formal do Design System, documentada aqui, e então aplicada
retroativamente onde fizer sentido?". Drift silencioso — um componente que
introduz um valor novo sem essa discussão — é o principal mecanismo pelo
qual produtos bem desenhados degradam com o tempo.

---

## 24. Implementation Principles

- Reutilizar componentes existentes (`src/components/ui/`) antes de criar
  novos.
- Atualizar um token (`tailwind.config.js` / `src/index.css`) antes de
  editar dezenas de componentes individualmente — a mudança deve propagar
  de cima para baixo na hierarquia do §22, nunca linha por linha em cada
  Page.
- Preferir uma correção no componente base (`Card`, `Button`, `Badge`...) a
  dezenas de correções locais duplicadas.
- Não duplicar componentes — se dois componentes fazem quase a mesma coisa
  (ex.: dois badges de risco com nomes diferentes), consolidar em um só
  parametrizado, seguindo o exemplo já em uso (`RiskBadge`/
  `ClassificationBadge`/`ConfidenceBadge` todos delegam para o mesmo
  `Badge` primitivo).
- **Não refatorar lógica funcional durante um redesign visual.** Alteração
  de classe CSS, estrutura de markup puramente visual e troca de token são
  aceitáveis; alteração de estado, de chamada a `supabase`, de regra de
  negócio ou de tipos de domínio nunca faz parte de uma tarefa de design.

---

## 25. STABILITY PRINCIPLE

> O Design System **não autoriza** alterações em: lógica de negócio, banco
> de dados, Supabase, RLS, autenticação, APIs, permissões, integrações,
> cálculos, algoritmos de inventário (ABC/XYZ, CBC, RCA, slotting, risco,
> auditoria estatística, contagem física).

Qualquer trabalho de redesign visual atua **exclusivamente na camada
visual**: classes Tailwind, markup de apresentação, tokens de
cor/tipografia/espaçamento/radius/sombra, e as bibliotecas de animação já
em uso (`motion`, `gsap`). Isso está alinhado com — e reforça — as regras
já declaradas em `CLAUDE.md.txt` na raiz do projeto (Princípio da
Estabilidade: nunca refatorar código funcionando, preservar arquitetura
existente, alterar somente o necessário).

Este documento em si é a prova disso: a tarefa que o gerou foi
exclusivamente de leitura e análise. Nenhum arquivo `.tsx`, `.ts`, `.css`,
configuração ou dependência do InventoryBlind foi alterado para produzi-lo.

---

## 26. DESIGN REVIEW CHECKLIST

Checklist a ser aplicado por qualquer agente (incluindo Claude Code) antes
de considerar uma tela ou componente "pronto", visualmente:

- Parece um dashboard SaaS genérico?
- Parece uma interface gerada por IA?
- Existem gradientes desnecessários?
- Existem sombras fortes?
- Existem cards demais?
- Existem cards dentro de cards?
- Existem badges demais, ou badges sem significado semântico real?
- Existem ícones decorativos (sem função)?
- Existem elementos excessivamente arredondados (fora da escala do §9)?
- A hierarquia tipográfica está clara e usa as classes do §4.2?
- SF Pro / o fallback definido em §4.4 está sendo usado corretamente (sem
  fonte proibida do §4.3 entrando por acidente)?
- As cores têm função (§5), ou foram escolhidas por variedade?
- A interface funciona em mobile (§20), com touch targets ≥44px?
- Dark Mode segue o mesmo sistema de tokens (§5.3), sem cor hardcoded que
  ignore o tema?
- Componentes seguem os mesmos tokens (§22), ou reintroduzem valores
  arbitrários?
- Existem estilos duplicados que deveriam ser um único Primitive (§24)?
- Algum componente parece pertencer a outro produto (fora do registro
  "silencioso" definido em §2)?
- O produto parece premium?
- O produto parece proprietário?

Uma resposta "sim" a qualquer uma das seis primeiras perguntas, ou "não" a
qualquer uma das últimas quatro, é motivo para revisar antes de prosseguir.

---

## 27. VISUAL NORTH STAR

> InventoryBlind deve ser reconhecido por precisão visual, clareza,
> hierarquia e sofisticação silenciosa.
>
> A interface não deve tentar impressionar o usuário com efeitos. Ela deve
> transmitir confiança através da consistência.
>
> Menos elementos. Melhor hierarquia. Melhor tipografia. Melhor
> espaçamento. Melhor composição. Melhor produto.

---

## 28. Nota final sobre esta entrega

Esta tarefa produziu exclusivamente este arquivo, `INVENTORYBLIND-DESIGN.md`.
Nenhum código do InventoryBlind foi modificado, nenhuma dependência foi
instalada, nenhum componente foi refatorado, nenhuma fonte foi trocada,
nenhum layout foi alterado. O documento acima descreve o estado real do
projeto (marcado como "Estado Atual — conforme" onde já implementado, e
"Estado Atual — a evoluir" onde há lacuna reconhecida) e formaliza os
princípios que devem orientar qualquer trabalho visual futuro, incluindo o
de Claude Code em tarefas subsequentes.
