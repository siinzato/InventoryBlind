

O InventoryBlind está funcional. Prioridade máxima: preservar estabilidade.



\## Estabilidade

\- Leia somente arquivos necessários para a tarefa atual.

\- Acesse outros arquivos apenas por dependência direta.

\- Não analise o projeto inteiro sem solicitação explícita.

\- Não refatore código funcionando fora do escopo.

\- Altere somente arquivos diretamente necessários.

\- Faça a menor mudança possível.



\## Preservação

\- Preserve 100% das funcionalidades existentes.

\- Preserve regras de negócio, fluxos e comportamento.

\- Preserve design, layout, estilos, responsividade, textos e UX.

\- Refatorações devem ser behavior-preserving e visual-preserving.



\## Arquitetura

\- Preserve arquitetura, padrões e componentes existentes.

\- Não reorganize pastas ou introduza abstrações sem necessidade.

\- Não adicione dependências se a estrutura atual resolver o problema.

\- Problemas fora do escopo devem apenas ser reportados.



\## Supabase

\- Não altere migrations, schema, RLS, policies, RPCs, grants ou autenticação salvo quando a tarefa pedir explicitamente.



\## Validação

Após mudanças de código, execute primeiro verificações diretamente relacionadas.

Quando aplicável ao escopo, finalize com:

npm run typecheck

npm run lint

npm run test

npm run build



Não corrija erros preexistentes e não relacionados.



\## Regra de parada

Se a solução exigir mudança de design, regra de negócio, banco, arquitetura ampla ou arquivos não relacionados, pare essa parte e informe antes de fazê-la.



\## Novidades (painel "O que há de novo no InventoryBlind?")

\- Sempre que uma tarefa entregar uma novidade, melhoria ou correção visível ao cliente, adicione uma entrada no topo de `src/lib/whatsNew.ts` (`WHATS_NEW_ENTRIES`), na categoria correta (`novidade`, `melhoria` ou `correcao`).

\- Use linguagem simples e orientada ao cliente, sem termos técnicos internos, nomes de tabela/função ou detalhes de segurança.

\- Mudanças internas sem efeito percebido pelo usuário (refactor, ajuste de infra, correção de lint, etc.) não entram no painel.

\- Isso é aditivo: não requer alterar `WhatsNewPanel.tsx` nem o header.



Crie somente esse arquivo/instrução. Não altere nenhum outro arquivo.

