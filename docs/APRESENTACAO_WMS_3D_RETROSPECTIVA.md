# WMS 3D — Retrospectiva Mensal

**Produto:** InventoryBlind · **Módulo:** Pulmão / Mapa 3D
**Data:** 18 de novembro de 2026 · **Base:** código em `main` + dados de produção medidos

---

## Aviso de precisão — leia antes de apresentar

Este documento foi escrito a partir do **código e do banco**, não do roteiro de intenção.
Quatro itens pedidos no briefing **não existem no produto** e por isso não aparecem como
entregas. Levá-los ao slide seria afirmar em reunião algo que a tela não faz:

| Pedido no briefing | Situação real | Onde está registrado |
|---|---|---|
| Busca por SKU **/ Lote** | A busca é por **SKU ou nome do produto**. Não há coluna de lote no estoque do pulmão. | `Warehouse3DViewer.tsx:1947` |
| Rota **doca ➔ pulmão ➔ picking** | Não há doca nem área de picking. As **71 vagas são todas `bin_type='pulmao'`** (confirmado: 1 único tipo distinto). | `warehouse3dRota.ts:10-16` |
| **Cálculo volumétrico / peso** | Não foi construído. Não existe coluna de peso nem de volume em `products` nem em `warehouse_storage_bins`. | `binSuggestion.ts:14` |
| Webhooks Tiny `inclusao_pedido`, `alteracao_estoque`, `inclusao_nota_entrada` | **0 ocorrências no repositório.** O Tiny v2 não tem API de registro de webhook — a integração é por *polling* com filtro de data. Ver §4. | `tinyProtocol.ts:57,74` |

O briefing também descreve o HUD como `bg-slate-950/95`. O HUD **não usa paleta Tailwind
crua** — usa os tokens do design system (`surface-2`, `rail`). A §3 traz o que está no código.

---

## 1. Visão geral — por que um 3D próprio

O controle de endereçamento tradicional é uma **lista**: um código (`PP-A01-N1`), um saldo,
uma linha. A lista responde "o que tem na vaga A01 nível 1". Ela não responde as perguntas
que o operador faz de pé no corredor:

- Onde isso fica, fisicamente?
- O que está perto?
- Esse item de alto giro está no nível 3, onde precisa de empilhadeira?
- Por onde eu passo para coletar esses cinco endereços?

O mapa 3D responde essas quatro. Ele **não cria dado novo** — lê o mesmo
`warehouse_storage_bins` e `warehouse_bin_stock` da lista. O que ele acrescenta é a
**dimensão espacial**, que já existia no galpão e não existia na tela.

**Armazém hoje (medido em produção, 18/11/2026):**

| Rua | Vagas | Módulos | Níveis |
|---|---|---|---|
| A | 39 | 13 | 1–3 |
| B | 9 | 3 | 1–3 |
| C | 7 | 7 | 1 |
| D | 16 | 16 | 1 |
| **Total** | **71** | **39** | — |

---

## 2. Detalhamento funcional

### Etapa 1 — Sinalização aérea e busca

**Placas suspensas por rua.** Cada rua recebe um rótulo aéreo renderizado dentro da cena,
não como HTML sobreposto — então ele respeita perspectiva e profundidade.

**Transparência dinâmica.** Ao filtrar uma rua, as demais ficam translúcidas em vez de
sumirem: *o filtro isola, não amputa*. O operador continua vendo o galpão inteiro e
entende onde a rua filtrada fica dentro dele.

**Busca.** `searchStock(termo)` com atraso de 300 ms, mínimo de 2 caracteres, casando
**SKU ou nome do produto**. Os resultados ganham contorno azul, que vence a cor de status:
achado o produto, a pergunta na tela passa a ser "onde ele está", não "como está a vaga".
Respostas de termos já abandonados são descartadas, e busca que falha não derruba o mapa —
volta a mostrar tudo, sem alarde.

> Detalhe que vale citar: a **ordem** das linhas é informação. `searchStock` devolve do
> saldo mais antigo para o mais novo — a ordem FIFO em que o estoque deve ser consumido.
> É exatamente essa ordem que vira a rota da Etapa 4.

### Etapa 2 — Mapa de calor por Curva ABC

Terceiro modo de cor do HUD (`ModoCor = 'status' | 'ocupacao' | 'abc'`), em
`warehouse3dAbc.ts`.

Cruza a **análise ABC publicada** (`listAnalyses` + `turnoverClassBySku`) com os SKUs
presentes em cada vaga (`skusByBin`). Três regras defendem a leitura:

- **Vaga mista assume a classe mais alta** (`PRIORIDADE = {A:3, B:2, C:1}`). Uma vaga com
  um item A e um item C é uma vaga A — ela é visitada na frequência do item A.
- **SKU sem classificação é excluído, não rebaixado a C.** Pintar o desconhecido de C
  seria afirmar baixo giro sem ter medido.
- **Alerta de giro:** item classe A acima do nível de piso (`nivel > 1`) é destacado em
  vermelho com pulso. É o achado acionável do modo — alto giro em altura custa
  empilhadeira a cada coleta.

### Etapa 3 — Minimapa 2D (radar de armazém)

`warehouse3dRadar.ts`. Planta baixa no HUD, com os níveis **colapsados em colunas** — a
vista de cima não tem altura, então empilhar níveis no mesmo ponto só repetiria o desenho.

O **cone de visão** acompanha a câmera. A sincronia é a parte técnica que merece o slide:
não há `setState` por quadro. Um componente lê a câmera no `useFrame` e escreve
`setAttribute` direto nos nós SVG. Atualizar estado do React 60 vezes por segundo
re-renderizaria a árvore inteira a cada quadro.

*Click-to-pan*: clicar no radar converte a coordenada local para a de mundo
(`localParaMundo`) e move a câmera. As duas malhas de coordenadas são distintas e a
conversão é explícita, porque a cena é desenhada deslocada para ficar centrada na origem.

### Etapa 4 — Rota de coleta animada

`warehouse3dRota.ts`. **O código é explícito sobre o que a rota não é**, e a apresentação
precisa ser também:

- **Não é rota ótima.** Rota ótima exige distância entre pontos; o pulmão não tem
  geometria levantada — `PP-A01-N1` é uma hierarquia, não uma coordenada.
- **Não começa em doca nem termina no picking.** Esses lugares não existem no cadastro.

**O que ela é:** a sequência de endereços de uma lista de coleta, na ordem FIFO que o
sistema já usa. A rota não inventa prioridade — ela desenha a que já existe.

**Traçado:** segue os eixos do armazém, não a linha reta. Dentro da mesma rua, anda-se ao
longo dos módulos; para trocar de rua, volta-se à **cabeceira** do corredor e atravessa-se
ali — linha reta entre ruas atravessaria as estantes. A travessia pela cabeceira é uma
**suposição declarada no código**: não há corredor transversal cadastrado, e a cabeceira é
o único ponto de travessia que o dado permite afirmar.

A animação da linha tracejada também não usa estado: muta `linha.material.dashOffset`
diretamente.

### Etapa 5 — Gêmeo digital em tempo real

`warehouse3dRealtime.ts` + migration `129_wms_realtime_publication`.

Duas tabelas foram adicionadas à publicação `supabase_realtime`: `warehouse_bin_stock` e
`warehouse_storage_bins`. A vaga muda de cor na tela de um operador quando outro movimenta
estoque, sem recarregar.

Três decisões sustentam isso:

1. **`replica identity full` em `warehouse_bin_stock`** — sem isso, o evento de DELETE não
   carrega o `bin_id` e a vaga esvaziada nunca seria repintada.
2. **O identificador é lido do registro novo e, se ausente, do antigo** (`bin_id` para
   estoque, `id` para vagas) — DELETE só tem o antigo.
3. **A assinatura recebe um *getter*, não um valor.** Se recebesse o mapa de códigos, cada
   recarga derrubaria e recriaria o WebSocket.

O isolamento entre empresas continua sendo o das policies de RLS já existentes
(`company_id = get_my_company_id()`), verificadas antes de publicar as tabelas.

**Captura para auditoria** (`warehouse3dSnapshot.ts`): exporta a cena como imagem com uma
tarja de legenda contendo data/hora, ângulo da câmera (azimute e elevação) e contexto.
O nome do arquivo é gerado sem dois-pontos — `:` é caractere inválido em nome de arquivo no
Windows, e a captura falharia silenciosamente na máquina da operação.

---

## 3. Design system tático

**Tipografia.** `@fontsource/jetbrains-mono` (^5.3.0), importado como **três pesos do
subset latino** (400, 500 e 600) em vez do pacote inteiro: 2,4 MB → 72 kB, e dentro do
chunk do mapa 3D, que já é carregado sob demanda.

O escopo é cirúrgico. A fonte só alcança o que está dentro da moldura `hud-3d`:

```css
.hud-3d .text-code,
.hud-3d-rotulo { font-family: 'JetBrains Mono', …; }
```

Assim o código técnico do HUD ganha a mono de alta precisão e **o resto do produto fica
intocado** — nenhuma regressão tipográfica fora da tela 3D.

**Ícones.** `lucide-react` (^0.344.0), a suíte que o produto já usa. Nenhuma biblioteca
nova entrou.

**Cor — e o que ela custou.** A linguagem de cor do HUD é disputada, e cada papel tem dono
único: **navy = ocupação · âmbar = alerta de capacidade · azul (#3B82F6) = resultado de
busca**. Quatro tentativas de reaproveitar âmbar ou azul para um significado novo foram
rejeitadas: duas cores com o mesmo tom param de significar coisas diferentes.

O fundo da cena usa o token `rail` (a navy da marca), **não** uma classe Tailwind crua — a
Design Constitution proíbe paleta crua na zona autenticada, e o mapa 3D respeita o sistema
de tokens inteiro (`surface-2`, `rounded-container`, `shadow-panel`).

**Geometria realista.** Os cubos genéricos deram lugar a estrutura de porta-pallets de
verdade (`warehouse3dEstrutura.ts`): montantes metálicos nas divisas dos módulos, **vigas
no topo de cada nível**, paletes de madeira e caixas de papelão com linhas de divisão por
camada. As medidas são constantes nomeadas (montante 9 cm, viga 7 cm, palete 12 cm), não
números soltos no meio do desenho.

**Performance — a decisão estruturante.** Tudo é `THREE.InstancedMesh`: a estante inteira
são **2 objetos de GPU**, e carga, palete, operador e marcadores um cada. A alternativa
testada — um elemento React por vaga — derrubou de 60 para 33 FPS em 5.000 vagas. As
arestas são fundidas numa geometria única. A seleção por clique usa uma malha invisível
por opacidade zero, e não `visible={false}`, porque o Three.js pula o raycast de objetos
invisíveis e as vagas vazias deixariam de ser clicáveis.

**Stack fixada:** `three@0.187` + `@react-three/fiber@8` + `@react-three/drei@9` — as
versões compatíveis com React 18. fiber 9 e drei 10 exigem React 19.

---

## 4. Integração com ERP (Tiny) — como de fato funciona

> **Correção necessária.** O briefing descreve "recebimento de webhooks HTTP POST sem
> necessidade de API Key no inbound", com os eventos `inclusao_pedido`,
> `alteracao_estoque` e `inclusao_nota_entrada`. Nenhum desses três nomes existe no
> repositório, e a arquitetura é outra. Apresentar o texto original afirmaria em reunião
> que temos um endpoint aberto — o que não é verdade, e é o oposto do que o código faz.

**4.1 Tiny: polling, não push.** A capacidade está declarada no código:

```ts
// `webhooks` is false: v2 has no webhook registration API. Incremental sync
// therefore relies on polling with a date filter, not on push.
webhooks: false,
```

A API v2 do Tiny **não oferece registro de webhook**. A sincronização incremental é feita
por consulta periódica com filtro de data. O conector declara o que consegue entregar
(`read_products`, `read_stock`, `read_orders`, `write_stock`, `write_adjustment`,
`write_transfer`) — inclusive transferência, implementada como duas movimentações
ordenadas, já que a v2 não tem endpoint atômico de transferência.

**4.2 O endpoint de webhook que existe** (`supabase/functions/integration-webhook`) é
genérico, para provedores que suportam push. Ele **não é aberto**:

- **Sem autenticação de usuário, sim — porque o chamador é um provedor, não uma pessoa.**
  A autenticidade vem de **assinatura HMAC**, obrigatória. Sem assinatura válida: **401**.
- URL `POST /integration-webhook/:providerKey/:connectionId` — o id da conexão vai no
  **caminho**, não no corpo, para que o segredo seja localizado antes de o corpo ser
  minimamente confiado.
- **Teto de corpo de 128 kB**, porque a rota é alcançável sem credencial e a assinatura só
  pode ser conferida depois de ler o corpo.
- **Respostas desenhadas contra retry:** 200 (aceito, duplicado ou definitivamente
  inaceitável), 401 (assinatura inválida), 400 (replay ou malformado), 500 (culpa nossa — e
  aí queremos o retry). Responder 500 a uma assinatura ruim faria o provedor **repetir um
  ataque por nós**.
- **O webhook enfileira, nunca executa.** Registra o evento e cria um job; o `pg_cron`
  executa. Sync inline estouraria o timeout, seria repetido e duplicaria trabalho.

---

## 5. Roteiro da reunião — 7 slides

### Slide 1 · O problema que a lista não resolve
**Tópicos:** o endereçamento como lista × as quatro perguntas do operador no corredor.
**Métrica:** 71 vagas, 39 módulos, 4 ruas, até 3 níveis.
**Nota do apresentador:** comece pela pergunta, não pela tecnologia. "Onde isso fica" é uma
pergunta que a tela antiga não respondia — e o galpão sempre teve três dimensões.

### Slide 2 · Ver o armazém (Etapas 1 e 3)
**Tópicos:** placas aéreas por rua · filtro que isola em vez de amputar · radar 2D com cone
de visão sincronizado · click-to-pan.
**Métrica:** busca com atraso de 300 ms; zero query nova — mesma fonte da lista.
**Nota:** demonstre ao vivo o filtro de rua. O ponto é a translucidez: a rua filtrada
continua **dentro** do galpão.

### Slide 3 · Decidir com cor (Etapa 2)
**Tópicos:** três modos — status, ocupação, curva ABC · vaga mista assume a classe mais
alta · SKU sem classificação fica de fora · alerta de item A acima do piso.
**Métrica:** a análise ABC publicada alimenta o modo; o alerta aponta alto giro em altura,
que custa empilhadeira por coleta.
**Nota:** o slide vende uma disciplina, não uma cor: **nunca pintar o desconhecido de C.**
Se perguntarem "e os SKUs sem classe?", a resposta é que ficam neutros, de propósito.

### Slide 4 · Andar menos (Etapa 4)
**Tópicos:** rota na ordem FIFO que o sistema já usa · traçado pelos eixos do armazém ·
travessia pela cabeceira do corredor.
**Métrica:** —
**Nota do apresentador — importante:** **não chame de rota ótima.** Se perguntarem por doca
e picking, a resposta honesta é que não existem no cadastro: as 71 vagas são todas pulmão.
Prometer doca hoje é prometer cadastro que ninguém fez.

### Slide 5 · Dois operadores, um armazém (Etapa 5)
**Tópicos:** Realtime sobre `warehouse_bin_stock` e `warehouse_storage_bins` · a vaga muda
de cor sem recarregar · captura de cena com tarja de auditoria (data/hora + ângulo).
**Métrica:** 2 tabelas adicionadas à publicação; isolamento por RLS já existente,
verificado antes de publicar.
**Nota:** o detalhe que impressiona é o DELETE — sem `replica identity full`, a vaga
esvaziada ficaria colorida para sempre. É o tipo de bug que só aparece em produção.

### Slide 6 · Que isso aguente o galpão inteiro
**Tópicos:** instanciação na GPU · estante inteira em 2 objetos · arestas fundidas · zero
`setState` por quadro · porta-pallets com montantes, vigas, paletes e caixas.
**Métrica:** **60 FPS com instanciação × 33 FPS com um elemento por vaga, em 5.000 vagas.**
Fonte JetBrains Mono: 2,4 MB → **72 kB** (3 pesos do latino), dentro do chunk sob demanda.
**Nota:** este é o slide técnico. O número 60×33 é o argumento — a escolha não foi
estética, foi o que permite crescer de 71 para 5.000 vagas sem reescrever.

### Slide 7 · Integração e o que vem depois
**Tópicos:** Tiny v2 sincroniza por **polling com filtro de data** (a v2 não registra
webhook) · o endpoint genérico de webhook é **assinado por HMAC**, enfileira e nunca
executa inline.
**Lacunas conhecidas, com número ao lado:**
- Filtro de divergências lê **0** — nenhuma vaga tem `capacity_boxes` preenchido.
- Volumetria e peso: **0 colunas** no banco. Não é adiamento de código, é cadastro.
- Doca e área de picking: **0 vagas** fora de `pulmao`.

**Nota de encerramento:** terminar pela lacuna é o que dá crédito ao resto. Cada item tem
um número que diz exatamente o que falta — e os três se resolvem com cadastro, não com
desenvolvimento.

---

## Apêndice — referências de código

| Assunto | Arquivo |
|---|---|
| Cena, HUD, modos de cor, busca | `src/components/wms/Warehouse3DViewer.tsx` |
| Geometria do porta-pallets | `src/lib/wms/warehouse3dEstrutura.ts` |
| Cruzamento com a Curva ABC | `src/lib/wms/warehouse3dAbc.ts` |
| Radar 2D e cone de visão | `src/lib/wms/warehouse3dRadar.ts` |
| Rota de coleta | `src/lib/wms/warehouse3dRota.ts` |
| Realtime | `src/lib/wms/warehouse3dRealtime.ts` |
| Captura para auditoria | `src/lib/wms/warehouse3dSnapshot.ts` |
| Layout e posicionamento | `src/lib/wms/warehouse3dLayout.ts` |
| Capacidades do Tiny | `src/lib/integrations/providers/tiny/tinyProtocol.ts` |
| Webhook de entrada | `supabase/functions/integration-webhook/index.ts` |

**Props públicas de `Warehouse3DViewer`:** `slots?`, `companyId?`, `onSelectSlot?`,
`onScanRequest?`, `onOperate?`, `className?`.

**Tabelas lidas pelo módulo 3D:** `warehouse_storage_bins`, `warehouse_bin_stock`,
`warehouse_bin_movements` (+ a análise ABC publicada, via `abcCurveService`).
