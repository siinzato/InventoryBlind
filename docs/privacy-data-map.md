# Mapa de dados pessoais — InventoryBlind

Documento **interno**. Levantado a partir do código e das migrations, não de
suposição. Onde não há decisão de negócio, está escrito **a definir** — nenhum
prazo aqui foi inventado, e nenhum deles é prometido ao usuário na política
pública.

Última revisão: 2026-08-20. Versão da Política de Privacidade correspondente:
`1.0.0-preliminar`.

## Papéis

| Contexto | Controlador | Operador |
|---|---|---|
| Dados da operação (produtos, contagens, notas, importações) | Empresa cliente | InventoryBlind |
| Conta, autenticação, segurança do serviço, auditoria | InventoryBlind | — |

## Categorias

| Categoria | Finalidade | Origem | Onde fica | Quem acessa | Compartilhamento | Retenção | Como excluir | Pendências |
|---|---|---|---|---|---|---|---|---|
| Credenciais de acesso (e-mail, hash de senha, confirmação, último login) | Autenticar e proteger a conta | Cadastro do usuário | `auth.users` (Supabase Auth) | O próprio usuário; Supabase como operador | Supabase | Enquanto a conta existir | Exclusão do usuário no Auth | Fluxo de exclusão de conta pelo próprio usuário não existe na interface — hoje é pedido pelo canal de contato |
| Perfil (nome, e-mail, empresa, papel, `must_change_password`) | Aplicar permissões e identificar quem age | Cadastro e gestão de usuários | `profiles` | O próprio usuário; owner/admin da mesma empresa | Supabase | Enquanto a conta existir | `DELETE` em `profiles` (há tela de gestão de usuários) | — |
| Vínculo empresa–usuário | Isolar dados por empresa | Onboarding e convites | `company_members`, `companies` | owner/admin da empresa | Supabase | Enquanto a empresa existir | Remoção do membro | — |
| Aceite de Termos e Política | Comprovar o aceite (obrigação legal / exercício de direitos) | Ação do usuário | `legal_acceptances` | O próprio usuário; owner/admin da mesma empresa | Supabase | **A definir** — natureza probatória sugere retenção longa | Sem exclusão pelo usuário, por ser prova | Definir prazo e política de expurgo |
| Dados da operação (produtos, localizações, contagens físicas, conferências de NF-e, importações, indicadores) | Fornecer o serviço contratado | Inserção e importação pela empresa | `products`, `physical_count_*`, `nfe_*`, `inventory_*`, e demais tabelas de operação | Usuários da empresa, conforme papel | Supabase; ERP externo **se** a empresa configurar integração | Enquanto a conta da empresa estiver ativa | Exclusão lógica em históricos; hard delete só em rascunho sem dependências | Definir prazo após encerramento do contrato |
| XML de NF-e | Conferência cega de recebimento | Upload ou consulta por chave | `nfe_invoices.raw_xml` | Usuários da empresa | Supabase | Enquanto a nota existir | Só com exclusão da nota nunca conferida | Contém dados de emitente/destinatário — avaliar necessidade de guarda do XML bruto |
| Auditoria (autor, ação, recurso, data, valores anteriores) | Rastrear quem fez o quê; segurança | Gerado pelo sistema | `audit_logs` | owner/admin da mesma empresa | Supabase | **A definir** — função probatória | Não expurgável pelo usuário, por construção | Definir prazo máximo e rotina de expurgo |
| Registros de segurança | Detectar e investigar acesso indevido | Gerado pelo sistema | `security_logs` | owner/admin da mesma empresa | Supabase | **A definir** | Não expurgável pelo usuário | Idem acima |
| Sincronização com ERP | Registrar tentativas de ajuste de estoque | Gerado pelo sistema | `erp_sync_events` | owner/admin | Supabase; ERP externo | Enquanto a sessão de contagem existir | Não expurgável isoladamente | — |
| Credenciais de integração | Conectar ERP da empresa | Configuração pela empresa | Tabelas de integração | owner/admin | Supabase; ERP externo | Enquanto a integração existir | Remoção da conexão | **Conferir se algum token é legível pelo frontend** — ver "Pontos a verificar" |
| Diagnóstico da operação | Recomendar plano | Respostas do usuário (opcional) | `raw_user_meta_data` do usuário | O próprio usuário | Supabase | Enquanto a conta existir | Não há botão de apagar as respostas | Adicionar exclusão das respostas |
| Preferências locais | Funcionamento da interface | Uso do sistema | `localStorage`/`sessionStorage` do dispositivo | Só o próprio dispositivo | Nenhum | Até o usuário limpar o navegador | Limpar dados do navegador | — |

## Armazenamento no dispositivo

Auditado no código. **Não há analytics, pixel de marketing, cookie de terceiro
nem rastreador** (busca por gtag, Google Tag Manager, Meta/Facebook, Hotjar,
Mixpanel, PostHog, Segment e Clarity: nenhuma ocorrência).

| Chave | Tipo | Para quê | Essencial |
|---|---|---|---|
| Sessão do Supabase Auth | localStorage | Manter o login entre telas e recarregamentos | Sim |
| `ib-theme` | localStorage | Tema claro/escuro | Sim (preferência) |
| `ib-sidebar-collapsed` | localStorage | Menu lateral recolhido | Sim (preferência) |
| `ib_whats_new_last_seen_id` | localStorage | Não repetir aviso de novidade já vista | Sim (preferência) |
| `ib_remember_workspace` | localStorage | Empresa selecionada, para quem tem mais de uma | Sim |
| `ib_operation_diagnostic_draft` | localStorage | Rascunho do diagnóstico | Sim (funcional) |
| `inventoryblind_pc_offline_queue` | localStorage | Contagens registradas offline, enviadas quando a rede volta | Sim (crítico — sem ela o trabalho offline é perdido) |
| `inventoryblind.pending-company-onboarding` | sessionStorage | Sobreviver ao redirect do link de confirmação de e-mail | Sim |
| `inventoryblind.pending-email` | sessionStorage | Idem | Sim |
| Consentimento de cookies | localStorage | Não repetir o aviso | Ver observação |

**Observação sobre o banner de cookies.** Existe um `CookieConsentBanner` no
projeto. Pela auditoria acima ele **não é exigido**: todo o armazenamento é
estritamente necessário, e nesse caso a base legal não é consentimento. O banner
atual também é do tipo "só aceitar", sem opção de recusa — padrão inadequado
justamente quando não há nada opcional a recusar. Recomendação: transformar em
aviso informativo sem botão de consentimento, ou remover. Decisão pendente.

## Transferência internacional

A infraestrutura é Supabase. A região do projeto **não foi verificada** e por isso
não é afirmada nem aqui nem na política pública. Pendência: confirmar a região do
projeto e, se estiver fora do Brasil, documentar a hipótese do art. 33 da LGPD
aplicável e o instrumento contratual correspondente.

## Subprocessadores identificados no projeto

| Fornecedor | Função | Como foi identificado |
|---|---|---|
| Supabase | Banco de dados, autenticação, storage, edge functions | `@supabase/supabase-js`, migrations, `supabase/functions/` |
| Provedor de hospedagem do frontend | Servir a aplicação | Build Vite estático — provedor **a confirmar** |
| ERP integrado (ex.: Tiny) | Sincronização de estoque | `src/lib/integrations/providers/` — só ativo se a empresa configurar |

## Pontos a verificar nesta etapa

- [ ] Confirmar que nenhum token de integração é retornado ao frontend em texto
      legível. Há tabelas de integração e uma migration recente de chaves de API
      feita em paralelo; **revisar antes de publicar a política**.
- [ ] Confirmar que mensagens de erro não expõem dado de outra empresa.
- [ ] Confirmar que nenhum `console.log` imprime senha, token ou chave.
- [ ] Definir prazos de retenção de `audit_logs`, `security_logs` e
      `legal_acceptances`.
- [ ] Definir e implementar fluxo de exclusão de conta a pedido do titular.
- [ ] Avaliar necessidade de guardar `raw_xml` integralmente.
