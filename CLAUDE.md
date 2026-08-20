

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



\## Sessões simultâneas (Claude Code CLI + app ao mesmo tempo)

Duas sessões do Claude trabalham neste repo em paralelo e não veem o trabalho em andamento uma da outra. Migrations são namespace compartilhado.

\### Nomeação de migration

O nome é `supabase/migrations/<TIMESTAMP>_<NNN>_<nome>.sql`. **O Supabase versiona pelo TIMESTAMP, não pelo NNN** — o `NNN` é só leitura humana.

Antes de nomear qualquer migration nova:

\1. Liste os arquivos locais (`ls supabase/migrations/`) **e** as migrations aplicadas no remoto. As duas listas divergem: o que é aplicado via MCP recebe timestamp novo do servidor, não o do arquivo.

\2. Escolha um TIMESTAMP maior que o da última migration **aplicada** e diferente de todos os arquivos locais. Confira duplicatas com: `ls supabase/migrations/ | sed -E 's/_.*//' | sort | uniq -d`

\3. Faça um grep por números planejados antes de reservar um — a outra sessão às vezes anuncia intenção em comentário de código antes de o arquivo existir.

Gravidade das colisões, da pior para a menos grave:

\- **TIMESTAMP duplicado** — grave: o timestamp é a versão.

\- **TIMESTAMP anterior à última aplicada** — quebra `supabase db push` com erro de histórico.

\- **`NNN` duplicado, timestamps diferentes** — cosmético. As duas aplicam normalmente.

\### CREATE OR REPLACE em função existente

É aqui que trabalho se perde em silêncio: duas migrations redeclarando a mesma função, e vence a última aplicada, sem erro nenhum. Antes de redeclarar, leia a definição VIVA do banco (`pg_get_functiondef`) e compare com o corpo que você está usando como base. Nunca transcreva de uma migration antiga assumindo que ainda é a versão atual.

\### Aplicar no banco

O banco remoto é compartilhado. Não aplique migration sem autorização explícita nesta conversa. Depois de a outra sessão aplicar algo, reconfira que suas próprias guardas continuam no lugar em vez de supor.

\### Arquivos disputados

`src/App.tsx` e `src/components/AuthPage.tsx` são os mais editados pelas duas sessões. `src/lib/whatsNew.ts` e o union `AuditAction` em `src/lib/auditLogService.ts` são listas aditivas: as duas sessões inserem no topo sem conflito de merge, então releia antes de editar. Nunca apague arquivo criado pela outra sessão — se houver contradição de produto, reporte ao usuário e deixe a decisão com ele.

