# Auditoria do módulo 3D — InventoryBlind WMS (Pulmão / Porta-Pallet)

Levantamento feito lendo o código atual na branch `main`, commit `69052bd` mais as
alterações não commitadas da planta física (migration 133) e do visual do porta-pallets.
Os números de linha referem-se ao estado do arquivo no momento da auditoria.

Stack: React 18.3 · TypeScript · Vite 5.4 · three 0.187 · @react-three/fiber 8.18 ·
@react-three/drei 9.122 · Tailwind · Supabase (PostgREST + Realtime).

**Não há GSAP nem Framer Motion em nenhum arquivo do módulo 3D** (`grep` por
`gsap|framer-motion|motion/react` em `src/components/wms` e `src/lib/wms` retorna vazio).
Toda animação da cena é `useFrame` mutando material/transform direto.

---

## 1. Arquitetura e arquivos

### 1.1 Inventário

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/components/wms/Warehouse3DViewer.tsx` | 4.096 | Componente único: HUD, `<Canvas>`, cena, builder, painéis, radar |
| `src/components/wms/WarehouseEnvironment.tsx` | 149 | Cenário (piso, paredes, faixas, `ContactShadows`). 100% cosmético |
| `src/lib/wms/warehouse3dLayout.ts` | 146 | `VAGA`, `Layout3DConfig`, `posicaoDaVaga`, `baseDaRua`, persistência em `localStorage` |
| `src/lib/wms/warehouse3dSlots.ts` | 133 | `Slot`, `statusDaVaga`, `buildSlots`, `loadWarehouseSlots` |
| `src/lib/wms/warehouse3dEstrutura.ts` | 188 | Montantes/vigas/palete/carga da vista **por código** |
| `src/lib/wms/warehouse3dPlantaFisica.ts` | 455 | Geometria da planta AZ 2027 (fileiras, vãos, treliça, mesas) |
| `src/lib/wms/planoFisicoService.ts` | 110 | Lê as medidas da planta da tabela `warehouse_plan_sections` (migration 133) |
| `src/lib/wms/warehouse3dAbc.ts` | 156 | Cruza endereço × Curva ABC publicada; `alertasDeGiro` |
| `src/lib/wms/warehouse3dRota.ts` | 160 | Paradas, traçado no piso, subidas até a vaga |
| `src/lib/wms/warehouse3dRadar.ts` | 194 | Planta baixa do radar, conversão mundo↔local, cone de visão |
| `src/lib/wms/warehouse3dRealtime.ts` | 118 | Canal Supabase Realtime; tradução UUID→código |
| `src/lib/wms/warehouse3dSnapshot.ts` | 113 | Ângulo da câmera, tarja e nome de arquivo da captura PNG |
| `src/lib/wms/builderObjects.ts` | 106 | Persistência das peças do Modo Edição (`warehouse_builder_objects`, migration 132) |
| `src/components/wms/WmsPulmaoPage.tsx` | 903 | Tela hospedeira; monta o visualizador na seção "Mapa 3D" |

Testes: 9 arquivos em `src/lib/wms/__tests__/warehouse3d*.test.ts`, 182 casos no total.
**Nenhum teste entra no `<Canvas>`** — não há `react-three-test-renderer`. O que está
dentro da cena só é conferido por screenshot.

### 1.2 Onde fica o `<Canvas>`

`Warehouse3DViewer.tsx:3502`, dentro de `FronteiraDeErro` (error boundary de classe,
linha 1427) e de uma `div` com `MOLDURA` (linha 2634):

```tsx
<Canvas
  camera={{ position: posicaoCamera, fov: FOV_BASE, near: 0.1, far: Math.max(200, distancia * 4) }}
  dpr={[1, 2]}
  gl={{ antialias: true }}
  onPointerMissed={() => setSelecionada(null)}
>
```

Filhos diretos: `<EnquadramentoResponsivo/>`, `<Cena .../>`, os controles
(`PointerLockControls`+`Caminhada` **ou** `OrbitControls`, mutuamente exclusivos),
`<SondaDeCamera/>`, `<PanSuave/>`, `<CapturadorDeCena/>`.

Hospedagem (`WmsPulmaoPage.tsx:40` e `:461`):

```tsx
const Warehouse3DViewer = lazy(() =>
  import('./Warehouse3DViewer').then(m => ({ default: m.Warehouse3DViewer })),
);
...
<div className="h-[calc(100vh-18rem)] min-h-[26rem]">
  <Suspense fallback={<BrandLoader label="Abrindo o mapa 3D" />}>
    <Warehouse3DViewer companyId={companyId} onSelectSlot={...} onOperate={...} onScanRequest={...} />
  </Suspense>
</div>
```

O `three/fiber/drei` fica num chunk próprio carregado sob demanda (chunk
`Warehouse3DViewer-*.js`, ~1,0 MB no build atual).

### 1.3 Como o estado é compartilhado

**Não há Context, Redux, Zustand nem store de qualquer tipo.** O módulo inteiro é
props + estado local:

- **32 `useState`** no componente principal (`Warehouse3DViewer`), mais 6 em
  subcomponentes; 29 `useEffect`, 24 `useMemo`, 9 `useRef`, 5 `useFrame` no arquivo.
- `<Cena>` recebe **31 props** (linhas 1148–1225). É prop drilling puro: `onHover`,
  `onSelect`, `onConstruir`, `onGirarObjeto`, `onExcluirObjeto` etc. descem como
  callbacks.
- Tema: hook `useTheme()` (contexto da aplicação, não do 3D) em
  `Warehouse3DViewer:2644` e de novo dentro de `PainelDetalhe:2029`.
- Preferência de estrutura (`Layout3DConfig`): `localStorage`, chave `ib.wms.layout3d`,
  com saneamento defensivo em `sanearLayout` (`warehouse3dLayout.ts:75`).
- Comunicação React → three fora do ciclo de render: `controlsRef`, `destinoRef`,
  `capturarRef`, `radarGrupoRef`, `radarConeRef`, `codigoPorBinIdRef`.

### 1.4 Fontes de dados (Supabase)

| Origem | Chamada | Onde |
|---|---|---|
| Endereços + saldo | `loadWarehouseSlots()` → `listBins()` + `boxesByBin()` | `:2901`, recarga silenciosa `:2986` |
| Curva ABC publicada | `loadAbcDoArmazem(companyId)` | `:2880` |
| Busca de SKU | `searchStock(termo)` (debounce 300 ms) | `:2946` |
| Conteúdo da vaga | `listBinContents(slot.id)` | `PainelDetalhe:2131` |
| Planta 2D publicada (imagem) | `getPublishedLayout` + `getFloorPlanSignedUrl` | `:2700` |
| Medidas da planta física | `carregarPlantaFisica(1)` (tabela `warehouse_plan_sections`) | `:2682` |
| Peças do builder | `listarPecas(1)` / `salvarPecas(..., 1)` | `:2734`, `:2752` |
| Tempo real | `assinarMudancasDoPulmao(companyId, ...)` | `:3033` |

### 1.5 Dois caminhos de render mutuamente exclusivos

Este é o fato arquitetural mais importante do módulo. O estado `mostrarPlantaFisica`
(`:2655`, **default `true`**) escolhe entre duas descrições do mesmo galpão:

- **Planta do galpão** (padrão): `<PlantaFisica3D>` (`:1518`) desenha fileiras nas
  medidas reais lidas do banco. Vãos por `vaosDaFileira`.
- **Vagas por código**: o bloco `{!plantaFisica && (<group position={deslocamento}>…)}`
  (`:1306`) desenha a grade aritmética (`rua × rowSpacing`, `modulo × moduleWidth`).

```tsx
{/* As vagas montadas pelo CÓDIGO. Saem de cena enquanto a planta física está desenhada */}
{!plantaFisica && (
<group position={deslocamento}>
```

As duas **não** têm o mesmo conjunto de recursos — ver §5.2.

---

## 2. Geometria e performance

### 2.1 Geometrias e materiais: todos em escopo de módulo

Criados uma vez, fora de qualquer componente (`:482`–`:648`), exatamente para não
realocar buffer de GPU por render:

```
GEOMETRIA_VAGA, GEOMETRIA_ARESTAS, GEOMETRIA_CARGA, GEOMETRIA_ARESTAS_CAMADA,
GEOMETRIA_PALETE, GEOMETRIA_COLUNA_RACK, GEOMETRIA_TRAVESSA_RACK, GEOMETRIA_UNITARIA,
GEOMETRIA_VIGA, GEOMETRIA_MARCADOR
MATERIAL_SOLIDO, MATERIAL_INVISIVEL, MATERIAL_COLUNA, MATERIAL_TRAVESSA,
MATERIAL_PALETE, MATERIAL_RAIOX, MATERIAL_VIGA, MATERIAL_MARCADOR, MATERIAL_ALERTA
MATRIZ (Matrix4), COR (Color), ESCALA (Vector3) — escratch reusados
```

A cor dos materiais de estrutura não vem por instância; é trocada por
`MATERIAL_COLUNA.color.set(...)` num `useEffect` de tema (`:805` e `:1476`) para não
recompilar shader a cada alternância claro/escuro.

**Nenhuma geometria é criada dentro do JSX da vista por código.** Na vista da planta,
sim — ver 2.3.

### 2.2 Instanciamento (vista por código)

7 `<instancedMesh>` no arquivo. O componente genérico é `LoteInstanciado` (`:667`), que
usa `THREE.InstancedMesh` **direto**, não `<Instances>/<Instance>` do drei. O comentário
registra a medição (`:653`–`:666`):

> O drei percorre TODAS as instâncias a cada quadro decompondo e recompondo a matriz de
> cada uma […] com 5.000 vagas a cena caía de 60 para 33 FPS, e o gargalo era CPU, não
> desenho.

As matrizes são escritas num `useEffect` dependente de `[vagas, deslocamentoY, corUniforme]`:

```tsx
vagas.forEach((vaga, i) => {
  MATRIZ.makeTranslation(vaga.posicao[0], vaga.posicao[1] + deslocamentoY, vaga.posicao[2]);
  malha.setMatrixAt(i, MATRIZ);
  if (!corUniforme) malha.setColorAt(i, COR.set(vaga.cor));
});
malha.count = vagas.length;
malha.instanceMatrix.needsUpdate = true;
```

Lotes desenhados na vista por código (`:1330`–`:1394`): `paletes`, `solidas`,
`divergentes` (material próprio, para pulsar), `raioX` (vidro), `fios` (apanhador de
clique invisível). Cada lote recebe `key={`solidas-${solidas.length}`}` — mudar a
contagem **remonta** o `instancedMesh`, porque a capacidade vai em `args` e não cresce
sozinha.

Estrutura: `EstruturaDeRack` (`:793`) = 2 objetos de GPU para o armazém inteiro;
`Vigas` (`:763`) = montantes de elevação; `MarcadoresDeGiro` (`:859`) = losangos de alerta.

Contornos: `fundirArestas` (`:506`) funde as arestas de N vagas numa única
`BufferGeometry`, com `useArestasFundidas` (`:536`) fazendo `dispose()` no cleanup.

### 2.3 A vista da planta (padrão) — malha por vão

`PlantaFisica3D` (`:1518`) é o oposto: **um `<mesh>` por elemento**, com
`<boxGeometry>` e `<meshStandardMaterial>` declarados no JSX (ou seja, uma geometria e
um material novos por vão, por render).

```tsx
{blocos.filter(b => b.tipo === 'fileira').map(b => {
  ...
  {vaosDaFileira(b).map(vao => {
    ...
    {!temCarga && (
      <mesh position={[vx, base + ALTURA_DO_PISO_DO_VAO / 2, vz]} onClick={aoClicar} ...>
        <boxGeometry args={[largura, ALTURA_DO_PISO_DO_VAO, profundidade]} />
        <meshStandardMaterial color={cor} ... />
      </mesh>
    )}
```

A única parte instanciada é a estrutura, extraída nesta auditoria para
`EstruturaDaPlanta` (`:1469`) — 2 objetos de GPU para as 604 peças (montantes +
diagonais num, longarinas no outro), com `aplicarPecas` (`:1505`) compondo R × S e
`setPosition`.

**Contagem medida em produção** (executada no navegador contra o banco real, térreo,
ruas A–H):

```
fileiras                9
montantes             220
longarinas             54
diagonais             330   → 604 peças = 2 draw calls
vãos (malhas)         303   → 303 draw calls + 303 elementos React
```

Antes da extração eram 274 malhas de estrutura + 303 de vão = 577 malhas; hoje são 305.
`vaosDaFileira(b)` é chamado **dentro do render**, e `blocos.filter(...)` é percorrido
3× por render (`:1559`, `:1569` via memo, `:1580`).

### 2.4 Quadro, sombra e efeitos

- **Não há `frameloop="demand"`**: o laço roda continuamente. Consumidores de `useFrame`:
  `PulsoDeAlerta` (`:742`), `SondaDeCamera` (`:901`), `PanSuave` (`:987`),
  `RotaDeColeta` (`:1095`), `Caminhada` (`:1960`).
- **Não há shadow map**: nenhum `castShadow`/`shadows` no arquivo. A única sombra é
  `ContactShadows` com `frames={1}` (`WarehouseEnvironment.tsx:136`), recalculada por
  `key={chaveDeSombra}` — string montada em `:3311` a partir das contagens e da extensão.
- Luzes: 3 no cenário "galpão" (`WarehouseEnvironment:94`–`96`), 2 no "limpo"
  (`:1243`–`1244`). Os dois são exclusivos; somar as luzes estouraria a cena.
- `MATERIAL_RAIOX` com `depthWrite: false`; `MATERIAL_INVISIVEL` com `opacity: 0`
  (e não `visible={false}`, porque o raycaster do three pula objeto invisível).
- `PulsoDeAlerta` anima **o material**, não as instâncias: um número por quadro.
- `prefers-reduced-motion` é respeitado em `PulsoDeAlerta` (`:737`) e em
  `RotaDeColeta` (`:1090`).

---

## 3. Dados e regras de WMS mapeadas visualmente

### 3.1 Status da vaga

`statusDaVaga` (`warehouse3dSlots.ts:74`), com precedência explícita:

```ts
if (bin.blocked) return 'blocked';
if (caixas === 0) return 'empty';
if (bin.capacityBoxes !== null && caixas > bin.capacityBoxes) return 'divergence';
return 'occupied';
```

`divergence` significa **somente capacidade excedida**. O comentário de cabeçalho
registra a medição que fechou a questão: dos 2.174 produtos com `products.location`
preenchido, **zero** casam com o padrão `PP-A01-N1`, então não há como ligar divergência
de contagem cega a uma vaga. O rótulo na tela é "Acima da capacidade", não "divergência".

### 3.2 Ocupação

`fracaoOcupacao` (`:380`): caixas/capacidade quando há capacidade; senão, caixas/maior
vaga do armazém. O próprio comentário diz que **nenhuma vaga tem capacidade cadastrada
hoje**, então na prática é sempre a comparação relativa. Faixas: `<0,4` / `<0,8` / resto
(`:402`–`404`).

### 3.3 Curva ABC (giro)

`loadAbcDoArmazem` (`warehouse3dAbc.ts:138`): pega a análise publicada mais recente,
lê `skusByBin()`, resolve `turnoverClassBySku`. Regras:

- A vaga é pintada pela classe **mais alta** presente (`PRIORIDADE A>B>C`, `:36`), porque
  endereço misturado é real.
- SKU fora da análise fica **sem classe** — a vaga cai em `COR_ATENUADA`, o mesmo cinza
  de "fora do filtro". Entrar como C seria afirmar baixo giro sem medir.
- `alertasDeGiro` (`:124`): classe A acima de `NIVEL_DE_PISO = 1`. A régua é "a
  empilhadeira precisa subir", não um nível absoluto — a spec pedia `>= 4` e o armazém
  só tem 3 níveis.
- A legenda mostra a **data** da análise (`:3701`): "era A naquele período".

### 3.4 Mapa de cor (precedência na cena)

Em `:3140`–`3146`, por vaga:

```
pulso (2 s, #38BDF8)  >  busca (#3B82F6)  >  cor do modo  >  atenuada
```

Modos (`ModoCor`): `status` → `COR_VAGA`; `ocupacao` → `ESCALA_OCUPACAO` (mesma navy em
3 intensidades); `abc` → `ESCALA_ABC` (violeta em 3 intensidades). As justificativas de
cada escolha estão nos comentários `:101`–`198`: matiz é significado, tom é quantidade, e
nenhuma família é reusada com dois sentidos.

### 3.5 Movimentação e endereçamento

- **Tempo real**: `assinarMudancasDoPulmao` escuta `warehouse_bin_stock` e
  `warehouse_storage_bins` filtrando `company_id`. O isolamento real é a RLS; o filtro é
  redundante de propósito. `codigoDaMudanca` traduz UUID→código (o saldo carrega `bin_id`,
  a tabela de endereços carrega `id` — trocar um pelo outro destacaria a vaga errada).
- O evento **pulsa** a vaga por 2 s (`destacarVaga:3009`) e **agenda recarga** com
  debounce de 400 ms (`agendarRecarga:3001`), usando `recarregarSilencioso` para não
  passar pela fase "carregando" e apagar a cena.
- **Clique numa vaga** → `PainelDetalhe` + `onSelectSlot` → a página hospedeira leva o
  código para a seção "Movimentar" (`WmsPulmaoPage:470`).
- **Modo Edição (builder)** grava em `warehouse_builder_objects` (migration 132), e a
  tabela é declaradamente **esboço**: peça não cria vaga, não recebe mercadoria, não
  entra em contagem.
- **Medidas da planta** (migration 133) vêm de `warehouse_plan_sections` com fallback
  para a constante `AZ2027_TERREO`; a cena só troca de estado quando `origem === 'banco'`
  (`:2685`).
- Vagas fora do padrão de código (`naoPosicionaveis`) não são desenhadas, mas o número
  aparece no HUD (`:4004`).

### 3.6 Rota de coleta

`warehouse3dRota.ts`. A ordem é a **FIFO que `searchStock` devolveu** — o módulo declara
em comentário que não é rota ótima (não há distância cadastrada; as 71 vagas são todas
`bin_type='pulmao'`, sem doca nem picking). O traçado anda pelos eixos e troca de rua
**pela cabeceira** (`cabeceiraZ`, `:89`), que é a única travessia que o dado permite
afirmar. A UI repete isso literalmente (`:3829`): "Não é a rota mais curta: o pulmão não
tem distâncias cadastradas."

---

## 4. Câmera, interação e UX

### 4.1 Câmera

- **Enquadramento inicial**: `enquadrarCamera` (`:428`) usa a **diagonal** da caixa
  envolvente × `FOLGA_CAMERA = 1.5`, na direção fixa `[7.5, 6.5, 9.5]`. Com a planta
  ligada, a posição é multiplicada por `plantaFisica.comprimento / extensaoDasVagas`
  (`:3363`), porque o contorno das vagas tem ~28 m e a planta tem 45,2 m.
- **FOV horizontal travado**: `EnquadramentoResponsivo` (`:457`) aumenta o fov vertical
  conforme o aspecto encolhe, com teto de 95°, para o galpão não ser cortado em tela
  estreita.
- **OrbitControls** (`:3550`): `enableDamping` 0,08; `minDistance 2`;
  `maxDistance = distancia * 2.5`; `maxPolarAngle = π/2.05` (trava acima do piso).
- **Caminhada em 1ª pessoa** (`:1934`): `PointerLockControls` resolve o olhar; o andar é
  manual — `getWorldDirection` achatado em Y **antes** de normalizar, passo
  `VELOCIDADE_A_PE * delta` (2,2 m/s), `camera.position.y` preso em 1,65 m, posição
  clampada em `±limite`. Na entrada a câmera é plantada em `(0, 1.65, limite*0.45)`.
- **Presets/foco**: `resetarCamera` (`:3373`, instantâneo, mesma conta do enquadramento
  inicial), `focarVaga` (`:3390`, instantâneo, recuo proporcional a
  `max(rowSpacing, moduleWidth) * 2.2`), `voarAteParada` (`:3411`, suave via `PanSuave`).
- **`PanSuave`** (`:970`): `lerp` exponencial com delta do quadro (`1 - 0.0025^delta`),
  encerra a < 2 cm do alvo, e **qualquer arraste do operador cancela** a transição
  (listener `start` do OrbitControls).

### 4.2 Radar (planta baixa)

`Radar` (`:2477`) é SVG, não WebGL. `SondaDeCamera` (`:890`) lê a câmera por quadro e
chama `atualizarRadar` (`:3245`), que escreve `transform` e `d` direto nos nós
(`setAttribute`) — **nenhum `setState` por quadro**. Há corte por diferença mínima
perceptível (0,004 m / 0,05° / 0,002), porque o damping nunca para em valores idênticos.
O clique usa `getScreenCTM().inverse()` (`:2520`) em vez de `getBoundingClientRect`,
porque `preserveAspectRatio` sobra margem.

### 4.3 Hover, clique, overlays

- Hover: `onPointerMove` no lote instanciado (não `onPointerOver`, porque o lote é um
  objeto só) → `setApontada` (estado React) → realce desenhado como `lineSegments` por
  cima, com `depthTest={false}`.
- `onPointerMissed` no `<Canvas>` fecha o painel de detalhe.
- 7 `<Html>` do drei: placas de rua (**sem** `distanceFactor`, de propósito — com ele a
  placa virava 6×9 px na vista geral), números das paradas da rota, rótulo de fileira
  (`distanceFactor={26}`), mini-barra girar/excluir do builder. Todos com
  `pointerEvents: 'none'` onde interceptariam clique, e com `w-max max-w-none` para
  escapar da regra global `max-width: 100%` do `index.css`, que colapsava o rótulo contra
  a âncora de largura zero do drei.
- HUD: painel esquerdo 15 rem (legenda + modo + busca + rota + filtros + botões), painel
  de detalhe 19 rem à direita, barra do builder centralizada embaixo, radar embaixo à
  direita. Ordem de empilhamento deliberada: o detalhe da vaga vence o radar (`:4066`).
- **Captura PNG** (`capturarCena:3326`): `gl.render()` antes de `toDataURL` (sem
  `preserveDrawingBuffer`, que penalizaria todo quadro), tarja de data/hora/ângulo
  desenhada **abaixo** do print num canvas 2D. O código declara que placas e números de
  parada **não** entram na imagem — são DOM, não pixels do WebGL.

---

## 5. Problemas reais e pontos frágeis

Ordenados por impacto.

### 5.1 A vista PADRÃO é a que não escala

A vista da planta (`mostrarPlantaFisica = true` por default) desenha **uma malha React
por vão**, com `boxGeometry`/`meshStandardMaterial` criados no JSX. Hoje são 303 vãos
para 215 endereços. A vista por código, que é a instanciada e preparada para 5.000
endereços, é a que está **desligada** por padrão.

Projeção linear: 5.000 endereços ≈ 5.000 malhas + 5.000 elementos React + 5.000
geometrias e materiais por render na vista padrão. O comentário de cabeçalho do arquivo
(`:13`–`17`) ainda afirma o contrário:

> As vagas são desenhadas com `<Instances>`: DOIS objetos de GPU no total […] o custo de
> GPU é praticamente o mesmo para 71 ou para 5.000

Isso descreve apenas o caminho `!plantaFisica`. Agravantes no mesmo componente:
`vaosDaFileira(b)` é recalculado no render e `blocos.filter(...)` é percorrido 3× por
render.

### 5.2 As duas vistas não são equivalentes, e o HUD não diz isso

Recursos que existem **só na vista por código**:

| Recurso | Vista por código | Vista da planta |
|---|---|---|
| Filtro de status (`filtro`) | sim | **não** |
| Resultado da busca (`achados`) | sim | **não** |
| Pulso de tempo real (`pulsando`) | sim | **não** |
| Rota de coleta | sim | **não** |
| Placas de rua | sim | rótulo próprio |
| Marcador de alto giro | sim | **não** |
| Modo de cor (status/ocupação/ABC) | sim | sim |
| Filtro de ruas | sim | sim |

`PlantaFisica3D` recebe apenas `modoCor`, `maxCaixas`, `abcPorVaga` e `ruasSelecionadas`.
Mas o painel esquerdo continua exibindo campo de busca, `Select` de filtro de status,
atalhos de alerta e a lista de paradas da rota **nos dois modos**. Na prática, no modo
padrão o operador digita um SKU, a tela responde "3 vagas encontradas" e **nada acende na
cena**.

### 5.3 Câmera e radar apontam para a geometria errada no modo padrão

Todos os alvos de câmera são calculados sobre a grade por código:

```tsx
const focarVaga = (alvo: VagaDesenhavel | undefined) => {
  const [x, y, z] = alvo.posicao;            // posicaoDaVaga → grade aritmética
  const alvoX = x + deslocamento[0];         // deslocamento da vista por código
```

`focarVaga` (`:3390`), `voarAteParada` (`:3411`) e `irParaNoRadar` (`:3271`) usam
`deslocamento`/`posicaoDaVaga`. Com a planta desenhada, a vaga está em **outro lugar**
(`PlantaFisica3D` usa seu próprio `group position={[-largura/2, 0, -comprimento/2]}`).
Consequência: "Ir até", "Avançar para a parada N" e clique no radar levam a câmera para
coordenadas que não correspondem ao que está na tela.

O mesmo vale para o radar inteiro: `celulasDoRadar(vagas, layout, ...)` (`:3232`) é
sempre a planta da grade por código — no modo padrão o "você está aqui" descreve uma
geometria que não está sendo desenhada.

### 5.4 `fiosAtenuados` é calculado e nunca desenhado

```tsx
fiosAtenuados: desenhaveis.filter(v => !v.ativa && v.slot.status === 'empty'),
```

Ele só entra em `todasDesenhaveis` (`:3219`), usado para achar o realce. **Não é passado
para `<Cena>`** (que não tem essa prop) e não há `lineSegments` sobre `fiosAtivos`
tampouco — os únicos contornos desenhados são `arestasDaCarga`, `arestasAchadas` e o
realce (`:1354`, `:1398`, `:1406`).

Efeito prático: na vista por código, **vaga livre não tem representação visível** — só o
apanhador de clique com `opacity: 0`. A legenda conta "Livre 207" e a cena não mostra
nenhuma delas. A docstring de `fundirArestas` (`:493`–`505`) descreve justamente o
contrário ("a leitura 'vazio é contorno'… por isso há dois lotes, ativo e atenuado"), o
que indica regressão em algum refactor anterior, não decisão.

### 5.5 Cerca da caminhada é frouxa, e não há colisão

`<Caminhada limite={extensao} />` (`:3547`) com `extensao ≈ 45,2`. O prédio ocupa
X ∈ [-5,15; 5,15] e Z ∈ [-22,6; 22,6]. A cerca permite andar até ±45 m nos dois eixos —
ou seja, **atravessar as paredes e sair do galpão** em X por quase 9×. Também não há
colisão com estante: a câmera passa por dentro dos porta-pallets.

Além disso o HUD afirma (`:4025`): "Enquanto caminha, clicar não abre vaga". Os `<mesh>`
dos vãos continuam com `onClick` registrado; com o ponteiro travado o raycast usa a
última posição conhecida. A afirmação não está garantida por código.

### 5.6 Acoplamento e tamanho

- `Warehouse3DViewer.tsx` tem 4.096 linhas e concentra: HUD, cena, builder, painel de
  detalhe, radar, modal de ajuste, captura e caminhada. `<Cena>` recebe 31 props.
- Qualquer `hover` chama `setApontada` → re-render do componente inteiro. Os `useMemo`
  protegem o **recálculo** dos arrays da cena (`apontada` não está nas deps), mas não a
  reconciliação da árvore.
- `MATERIAL_COLUNA`/`MATERIAL_TRAVESSA` são singletons de módulo mutados por efeito de
  tema a partir de **dois** componentes diferentes (`EstruturaDeRack` e
  `EstruturaDaPlanta`). Hoje eles nunca coexistem, mas é acoplamento implícito.

### 5.7 Três fontes de verdade para a medida da estante

| Fonte | Onde | Usada por |
|---|---|---|
| `VAGA` + `ESTRUTURA` | `warehouse3dLayout.ts:17`, `warehouse3dEstrutura.ts:25` | vista por código |
| `PROFUNDIDADE_DA_FILEIRA`, `ALTURA_DA_FILEIRA`, `PASSO_DA_POSICAO`, `NIVEIS_POR_FILEIRA` | `warehouse3dPlantaFisica.ts` | vista da planta |
| `CATALOGO` / `ESTANTES` | `Warehouse3DViewer.tsx:295`, `:320` | builder |

A migration 133 moveu para o banco apenas as medidas de **trecho** (z, comprimento,
nº de fileiras, corredores, rótulos). Largura do prédio (10,3), altura da estante (4,2),
passo da posição (1,2) e nº de níveis (3) continuam constantes no código — corrigir
qualquer uma delas ainda exige deploy.

### 5.8 Multi-pavimento existe no banco e não na tela

`const ANDAR_DO_MAPA = 1` (`:264`) é usado em `carregarPlantaFisica`, `listarPecas` e
`salvarPecas`. As migrations 130/131/133 preveem pavimento, e há rascunho de 2º andar
criado no banco, mas **o 3D só desenha o térreo** e não há seletor.

### 5.9 Responsividade

O módulo trata o aspecto da **câmera** (§4.1) mas não o do **HUD**: painel esquerdo de
15 rem, painel de detalhe de 19 rem, barra do builder e radar de 12 rem são todos
`absolute` com largura fixa sobre um canvas que, em celular em pé (~380 px), não comporta
dois deles lado a lado. Não há colapso, drawer nem breakpoint — só o
`max-h-[calc(100%-1.5rem)] overflow-y-auto` do painel esquerdo, que resolve altura, não
largura. `min-h-[24rem]` na moldura é a única garantia de que o canvas não colapsa.

### 5.10 Pontos menores, confirmados no código

- **`frameloop` contínuo**: sem `demand`, a GPU trabalha mesmo com a cena parada. O
  damping, o pulso e o tracejado precisam de quadro, mas poderiam ser condicionados.
- **Prop `camera` do `<Canvas>`**: `posicaoCamera` muda quando a planta chega do banco e
  a extensão muda. No fiber 8 a prop de câmera é aplicada na criação; o reenquadramento
  depende do botão "Resetar câmera". Vale confirmar com um teste de mudança de extensão
  em runtime.
- **Geometria intermediária não liberada** (`:588`): o `new BoxGeometry(...)` passado a
  `EdgesGeometry` não é guardado nem `dispose`ado. Custo único, não vazamento por render.
- **Remonte por `key`**: cada mudança de contagem de um lote recria o `InstancedMesh`
  (buffers novos). Em galpão movimentado com tempo real, isso acontece a cada recarga.
- **Recarga é full refetch**: qualquer evento de tempo real dispara
  `listBins() + boxesByBin()` inteiros (debounce 400 ms). Não há atualização incremental
  da vaga que mudou.
- **Builder salva por delete-então-insert do pavimento** (`builderObjects.ts:79`): duas
  pessoas editando ao mesmo tempo, a última sobrescreve; não há verificação de conflito.
  As peças são carregadas uma única vez na montagem.
- **`PainelDetalhe` refaz `listBinContents` a cada seleção**, sem cache; abrir a mesma
  vaga 10 vezes são 10 consultas.
- **Sem teste dentro do Canvas**: 182 casos cobrem a aritmética (posição, status, ABC,
  rota, radar, snapshot, planta), nada cobre o que o `<Canvas>` monta.
- **Comentário de cabeçalho desatualizado** (`:19`–`20`): "Este arquivo ainda não é
  importado por nenhuma tela — plugá-lo numa rota é passo separado e deliberado." Ele é
  importado por `WmsPulmaoPage` desde a seção "Mapa 3D".

---

## Resumo em uma frase

A aritmética do módulo é sólida, testada fora do WebGL e bem documentada no próprio
código; a fragilidade está em ter **duas descrições concorrentes do mesmo galpão** — uma
instanciada, completa em recursos e desligada por padrão; outra desenhada malha a malha,
sem busca/filtro/rota/tempo real e ligada por padrão — com a câmera, o radar e metade do
HUD ainda falando as coordenadas da primeira.
