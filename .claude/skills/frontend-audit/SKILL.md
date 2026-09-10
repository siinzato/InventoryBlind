---
name: frontend-audit
description: Auditoria visual read-only da UI do InventoryBlind contra a Design Constitution (.claude/INVENTORYBLIND-DESIGN.md). Use quando pedirem para revisar/auditar o design de uma tela ou componente, verificar se algo "parece template SaaS / gerado por IA", checar drift de tokens (cor, radius, sombra, tipografia), rodar o design review checklist, ou antes de considerar uma tela visualmente pronta. Também para revisar um diff de redesign antes de commit.
---

# Frontend Audit — InventoryBlind

Auditoria da **camada visual apenas**. Esta skill diagnostica e reporta; ela
**não aplica correções** a menos que o usuário peça explicitamente depois de
ver o relatório.

## Regra de escopo (não negociável)

A §25 STABILITY PRINCIPLE do design doc proíbe, em qualquer trabalho visual,
tocar em: lógica de negócio, Supabase, RLS, auth, permissões, APIs, cálculos e
algoritmos de inventário (ABC/XYZ, CBC, RCA, slotting, risco, contagem física).
Se um achado visual só se resolve alterando estado, tipo de domínio ou chamada
de dados, **reporte como fora de escopo** em vez de propor a mudança.

## Antes de auditar

1. Leia `.claude/INVENTORYBLIND-DESIGN.md` — é a fonte da verdade. As seções
   mais usadas: §3 (anti-AI), §4.2 (escala tipográfica), §5 (cor), §7 (cards),
   §9/§10 (radius/sombra), §23 (anti-drift), §26 (checklist).
2. Determine o alvo. Sem alvo explícito, audite o diff:
   `git diff --stat main...HEAD -- 'src/**/*.tsx' 'src/**/*.css'`
3. Identifique a **zona** de cada arquivo — as regras diferem:
   - **Zona app (autenticada)** — regras estritas. Tokens: `surface`,
     `surface-2`, `surface-3`, `edge`, `fg`, `fg-muted`, `fg-subtle`,
     `accent`, `accent-strong`.
   - **Zona expressiva** — `src/components/landing/`, `LandingPage.tsx`,
     `AuthPage.tsx`, `effects/GlitterWrap.tsx`. Linguagem mais rica é
     permitida (GSAP, glitter). Tokens: escala fixa `ink-*`, `mist-*`,
     `enterprise-*`.
   - **Vazamento entre zonas é sempre um achado** (§5.2): a landing nunca
     referencia `surface`/`fg`/`edge`; o app nunca referencia
     `ink`/`mist`/`enterprise`.

## Gates automatizáveis

Rode estes greps no alvo. Cada hit é um **candidato** — confirme lendo o
contexto antes de reportar (`rounded-full` num badge de status é correto; num
container estrutural não é).

| # | Gate | Padrão | Ref |
|---|---|---|---|
| 1 | Gradiente decorativo | `bg-gradient-to\|bg-clip-text\|gradient(` | §3 |
| 2 | Glow / sombra colorida | `shadow-\[.*(rgb\|#)\|drop-shadow-\|shadow-(blue\|purple\|emerald\|amber\|red)` | §3 |
| 3 | Blur sem função | `backdrop-blur\|blur-(2xl\|3xl)` | §3, §6 |
| 4 | Sombra fora da escala | `shadow-(sm\|md\|lg\|xl\|2xl)` → deve ser `shadow-control\|panel\|overlay` ou nenhuma | §10, §23 |
| 5 | Radius fora da escala | `rounded-(2xl\|3xl)` → deve ser `rounded-control\|container\|sheet` | §9, §23 |
| 6 | Cor hardcoded | `#[0-9a-fA-F]{3,8}\|rgb(\|hsl(` em `.tsx` | §5.3, §23 |
| 7 | Paleta Tailwind crua no app | `(text\|bg\|border)-(gray\|slate\|zinc\|neutral\|stone)-[0-9]` | §5, §23 |
| 8 | Vazamento landing→app | `ink-\|mist-\|enterprise-` fora da zona expressiva | §5.2 |
| 9 | Vazamento app→landing | `surface\|fg-muted\|fg-subtle\|border-edge` dentro de `landing/` | §5.2 |
| 10 | Fonte fora do stack | `font-\[\|@font-face\|font-(serif\|display:)` não previsto | §4.3, §23 |
| 11 | Ícone fora do lucide | `import .* from ['"](react-icons\|@heroicons\|phosphor)` | §11, §23 |
| 12 | Emoji na UI | emoji literal em JSX/string de label | §3 |
| 13 | Tipografia ad-hoc | `text-(3xl\|xl\|base)\s.*font-semibold` onde existe `.text-display/.text-title/.text-headline` | §4.2 |
| 14 | Pill excessivo | `rounded-full` em elemento que não é badge de status, avatar ou dot | §3 |

## Gates que exigem leitura (não greppáveis)

- **Card dentro de card.** Procure `<Card` aninhado em `<Card`, ou `<Card` dentro
  de `<Panel>`. O padrão correto é **um** `Panel` com múltiplas `PanelSection`
  separadas por `border-t` (§7). Ver `src/components/ui/Panel.tsx`.
- **Teste de eliminação de card.** Para cada card/box: ele agrupa informação,
  separa contexto, estabelece hierarquia ou representa uma unidade funcional?
  Se só desenha uma borda em volta do conteúdo, o achado é "remover o card e
  deixar o conteúdo no fundo do painel" (§7).
- **Agrupar, não empilhar.** N caixas pequenas com borda lado a lado (4 KPIs,
  health-index + rankings) devem ser UM painel com divisores internos
  (`divide-x`/`divide-y`/`border-t`), nunca N caixas.
- **Disciplina de cor.** `accent` só para ação, link e estado ativo/selecionado
  — nunca decoração. Semânticas (emerald/amber/red) só para estados que
  genuinamente pedem atenção. Um estado *default* que a maioria das linhas terá
  (ex.: badge "em andamento") deve ser neutro/cinza, não colorido.
- **Tabelas são protagonistas.** Minimizar chrome do container; separadores de
  linha quase invisíveis; hover extremamente sutil; maximizar espaçamento de
  linha e legibilidade (§16).
- **KPI.** Estrutura Label → Value → Context → Trend. Sem ícone gigante, sem
  ícone em círculo colorido, sem número solto sem label (§17).
- **Padding/radius mínimos que ainda respiram** — `Card`/`Panel` expõem
  `padding: 'none'|'sm'|'md'|'lg'`; `lg` por default é um achado (§7).
- **Dark mode.** Qualquer cor que ignore o sistema de tokens quebra o tema (§5.3).
- **Touch targets ≥44px** e funcionamento mobile (§20).

## Severidade

- **BLOCKER** — viola §3 (anti-AI) ou §23 (introduz token novo sem
  documentar), ou quebra dark mode. Impede considerar a tela pronta.
- **MAJOR** — card supérfluo, card-em-card, cor sem função, tabela com chrome
  excessivo, hierarquia tipográfica confusa.
- **MINOR** — padding/radius subótimo, duplicação que deveria virar primitive
  (§24), inconsistência pontual.
- **OUT-OF-SCOPE** — só se resolve alterando lógica/dados. Reportar, não agir.

## Veredito final

Depois dos achados, responda ao checklist §26 e aplique a regra de corte:
"sim" a qualquer uma das seis primeiras perguntas (dashboard genérico / cara de
IA / gradiente desnecessário / sombra forte / cards demais / card em card), ou
"não" a qualquer uma das quatro últimas (hierarquia clara / cores com função /
parece premium / parece proprietário) → **revisar antes de prosseguir**.

Encerre com o gut-check literal que o usuário pediu: *esconda a logo e imagine
o screenshot — alguém acreditaria que isso saiu da Apple, Linear ou Stripe?*
Se não, a direção é **reduzir** caixas/bordas/cores, nunca adicionar.

## Formato do relatório

```
## Escopo
<arquivos auditados, zona de cada um>

## Achados
### BLOCKER
- `src/components/X.tsx:42` — <o que está errado> (§3)
  Correção: <mudança visual mínima>
### MAJOR / MINOR / OUT-OF-SCOPE
...

## Checklist §26
<18 perguntas, resposta curta>

## Veredito
PRONTO | REVISAR — <uma frase>
```

Sem achados em uma categoria, escreva "nenhum" em vez de omitir a seção.
Nunca aplique correções sem pedido explícito.
