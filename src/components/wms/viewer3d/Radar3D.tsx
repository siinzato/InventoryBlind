// O radar: a planta baixa que diz onde a câmera está e para onde ela olha.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de
// comportamento. É SVG, não WebGL — por isso não mora na cena.

import { useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Compass } from 'lucide-react';
import { Button, Panel, PanelSection } from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import { caminhoDoCone, type AreaRadar, type CelulaRadar } from '../../../lib/wms/warehouse3dRadar';
import { COR_ALERTA_GIRO, COR_GRADE, COR_REALCE, COR_VAGA } from './aparencia';


// ── Radar (planta baixa) ───────────────────────────────────────────────────────

/**
 * Vista de cima do armazém, com onde a câmera está e para onde ela olha.
 *
 * Orbitar em 3D desorienta: três arrastes e já não se sabe qual corredor está na
 * frente. O radar devolve a referência que a vista em perspectiva tira — é o mesmo
 * papel do "você está aqui" de um mapa de shopping.
 *
 * O cone e o marcador são movidos por `setAttribute`, de fora do React. Este componente
 * só re-renderiza quando o ARMAZÉM muda (filtro, layout, alerta), nunca quando a câmera
 * se move — e a câmera se move em todo quadro.
 */
export function Radar({
  celulas,
  area,
  theme,
  aberto,
  onAlternar,
  onIrPara,
  grupoRef,
  coneRef,
}: {
  celulas: CelulaRadar[];
  area: AreaRadar;
  theme: Theme;
  aberto: boolean;
  onAlternar: () => void;
  onIrPara: (x: number, z: number) => void;
  grupoRef: RefObject<SVGGElement>;
  coneRef: RefObject<SVGPathElement>;
}) {
  // Uma linha por rua, do primeiro ao último módulo: é o corredor, e é o que dá ao
  // radar a forma de planta em vez de nuvem de pontos soltos.
  const corredores = useMemo(() => {
    const porRua = new Map<number, { x: number; z1: number; z2: number; rotulo: string }>();
    for (const c of celulas) {
      const atual = porRua.get(c.rua);
      if (atual) {
        atual.z1 = Math.min(atual.z1, c.z);
        atual.z2 = Math.max(atual.z2, c.z);
      } else {
        porRua.set(c.rua, { x: c.x, z1: c.z, z2: c.z, rotulo: c.ruaCodigo });
      }
    }
    return [...porRua.values()];
  }, [celulas]);

  const alcanceDoCone = Math.max(area.largura, area.profundidade) * 0.55;
  const [grade, linha] = COR_GRADE[theme];

  const aoClicar = (evento: ReactMouseEvent<SVGSVGElement>) => {
    // A matriz do próprio SVG faz a inversão. Calcular na mão a partir do
    // `getBoundingClientRect` erraria sempre que o `preserveAspectRatio` sobrasse
    // margem — e ele sobra, porque o armazém quase nunca tem a proporção do quadro.
    const svg = evento.currentTarget;
    const matriz = svg.getScreenCTM();
    if (!matriz) return;
    const ponto = svg.createSVGPoint();
    ponto.x = evento.clientX;
    ponto.y = evento.clientY;
    const local = ponto.matrixTransform(matriz.inverse());
    onIrPara(local.x, local.y);
  };

  return (
    <Panel className="pointer-events-auto absolute bottom-3 right-3 w-[12rem] max-w-[calc(100%-1.5rem)]">
      <PanelSection padding="sm" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {/* `aria-hidden`: o ícone repete o rótulo ao lado, e um leitor de tela que
              anuncia "bússola Radar" só atrapalha. */}
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <Compass aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            Radar
          </span>
          <Button variant="ghost" size="sm" onClick={onAlternar} aria-expanded={aberto}>
            {aberto ? 'Recolher' : 'Expandir'}
          </Button>
        </div>

        {aberto && (
          <>
            <svg
              viewBox={`${area.minX} ${area.minZ} ${area.largura} ${area.profundidade}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-28 w-full cursor-pointer rounded-control bg-surface-2"
              onClick={aoClicar}
              role="img"
              aria-label={`Planta do armazém com ${celulas.length} posições vistas de cima. Clique para levar a câmera.`}
            >
              {/* Corredores. `non-scaling-stroke` mantém a espessura em PIXELS: sem
                  isso a linha engrossaria junto com o zoom do viewBox e um armazém
                  pequeno viraria um borrão de traços. */}
              {corredores.map(c => (
                <line
                  key={c.rotulo}
                  x1={c.x}
                  y1={c.z1}
                  x2={c.x}
                  y2={c.z2}
                  stroke={linha}
                  strokeWidth={6}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {celulas.map(c => (
                <circle
                  key={`${c.rua}-${c.modulo}`}
                  cx={c.x}
                  cy={c.z}
                  r={Math.max(area.largura, area.profundidade) * 0.012}
                  fill={
                    // A MESMA linguagem de cor da cena 3D. O radar é um mapa do que está
                    // ali do lado; ensinar duas cores para o mesmo alerta faria o
                    // operador reaprender o significado ao mudar de instrumento.
                    c.altoGiro ? COR_ALERTA_GIRO : c.divergencia ? COR_VAGA[theme].divergence : grade
                  }
                />
              ))}

              {/* Câmera: cone de visão e vértice. Movido por fora do React. */}
              <g ref={grupoRef}>
                <path ref={coneRef} d={caminhoDoCone(0.6, alcanceDoCone)} fill={COR_REALCE[theme]} opacity={0.22} />
                <circle cx={0} cy={0} r={Math.max(area.largura, area.profundidade) * 0.018} fill={COR_REALCE[theme]} />
              </g>
            </svg>

            <p className="text-xs leading-relaxed text-fg-subtle">
              Clique na planta para levar a câmera até o ponto.
            </p>
          </>
        )}
      </PanelSection>
    </Panel>
  );
}
