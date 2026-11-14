// O que vai ESCRITO na imagem de auditoria.
//
// O que está em jogo: a imagem é prova. Um ângulo invertido manda o auditor ao lado
// errado da estante, e uma data que muda com o fuso da máquina torna duas auditorias
// incomparáveis — que é justamente o motivo de guardar a imagem.

import { describe, it, expect, vi } from 'vitest';
import {
  ALTURA_DA_TARJA, anguloDaCamera, carimboDeArquivo, dataHoraPtBr,
  desenharLegenda, legendaDaAuditoria, nomeDoArquivo,
} from '../warehouse3dSnapshot';

// 14/11/2026 15:32 na hora LOCAL — as funções formatam em hora local de propósito,
// que é a hora que o operador viu no relógio ao capturar.
const quando = new Date(2026, 10, 14, 15, 32, 7);

describe('anguloDaCamera', () => {
  it('olhar no sentido +Z é azimute 0', () => {
    expect(anguloDaCamera([0, 0, -10], [0, 0, 0]).azimute).toBeCloseTo(0, 10);
  });

  it('olhar no sentido +X é azimute 90', () => {
    expect(anguloDaCamera([-10, 0, 0], [0, 0, 0]).azimute).toBeCloseTo(90, 10);
  });

  it('nunca devolve ângulo negativo — o relatório não faz o leitor converter', () => {
    const { azimute } = anguloDaCamera([10, 0, 0], [0, 0, 0]);
    expect(azimute).toBeGreaterThanOrEqual(0);
    expect(azimute).toBeLessThan(360);
    expect(azimute).toBeCloseTo(270, 10);
  });

  it('câmera acima do alvo tem elevação POSITIVA', () => {
    // Olhar de cima para baixo é o caso normal deste mapa; sinal trocado aqui
    // descreveria uma câmera enterrada no piso.
    expect(anguloDaCamera([0, 10, -10], [0, 0, 0]).elevacao).toBeCloseTo(45, 10);
  });

  it('câmera direto em cima é elevação 90', () => {
    expect(anguloDaCamera([0, 10, 0], [0, 0, 0]).elevacao).toBeCloseTo(90, 10);
  });

  it('câmera na horizontal é elevação 0', () => {
    expect(anguloDaCamera([0, 0, -10], [0, 0, 0]).elevacao).toBeCloseTo(0, 10);
  });

  it('mede a distância real em três dimensões', () => {
    expect(anguloDaCamera([3, 4, 0], [0, 0, 0]).distancia).toBeCloseTo(5, 10);
  });

  it('câmera em cima do alvo devolve zeros, nunca NaN', () => {
    expect(anguloDaCamera([2, 2, 2], [2, 2, 2])).toEqual({ azimute: 0, elevacao: 0, distancia: 0 });
  });
});

describe('nome do arquivo', () => {
  it('carimbo é ordenável por nome', () => {
    expect(carimboDeArquivo(quando)).toBe('2026-11-14_15-32');
    const antes = carimboDeArquivo(new Date(2026, 10, 14, 9, 5));
    expect(antes < carimboDeArquivo(quando)).toBe(true);
  });

  it('zero à esquerda em mês, dia, hora e minuto', () => {
    expect(carimboDeArquivo(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02_03-04');
  });

  it('não usa dois-pontos — quebraria o nome no Windows', () => {
    expect(nomeDoArquivo(quando)).not.toContain(':');
    expect(nomeDoArquivo(quando)).toBe('armazem-3d_2026-11-14_15-32.png');
  });
});

describe('legendaDaAuditoria', () => {
  it('escreve data e hora no formato brasileiro', () => {
    expect(dataHoraPtBr(quando)).toBe('14/11/2026 15:32');
  });

  it('carrega quando, de que direção, de que altura e de que distância', () => {
    const legenda = legendaDaAuditoria(quando, { azimute: 42.4, elevacao: 31.2, distancia: 24.34 });
    expect(legenda).toContain('14/11/2026 15:32');
    expect(legenda).toContain('azimute 42°');
    expect(legenda).toContain('elevação 31°');
    expect(legenda).toContain('24,3 m');
  });

  it('usa vírgula decimal, como o resto do produto', () => {
    const legenda = legendaDaAuditoria(quando, { azimute: 0, elevacao: 0, distancia: 7.5 });
    expect(legenda).toContain('7,5 m');
    expect(legenda).not.toContain('7.5');
  });
});

describe('desenharLegenda', () => {
  const contextoFalso = () => {
    const chamadas: { fillRect: number[][]; fillText: [string, number, number][]; cores: string[] } = {
      fillRect: [], fillText: [], cores: [],
    };
    const ctx = {
      set fillStyle(v: string) { chamadas.cores.push(v); },
      font: '',
      textBaseline: '' as CanvasTextBaseline,
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => { chamadas.fillRect.push([x, y, w, h]); }),
      fillText: vi.fn((t: string, x: number, y: number) => { chamadas.fillText.push([t, x, y]); }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, chamadas };
  };

  it('desenha a tarja ABAIXO do desenho, sem cobrir o armazém', () => {
    const { ctx, chamadas } = contextoFalso();
    desenharLegenda(ctx, 800, 600, 'teste');
    const [x, y, w, h] = chamadas.fillRect[0];
    expect(x).toBe(0);
    expect(y).toBe(600);
    expect(w).toBe(800);
    expect(h).toBe(ALTURA_DA_TARJA);
  });

  it('escreve o texto dentro da tarja', () => {
    const { ctx, chamadas } = contextoFalso();
    desenharLegenda(ctx, 800, 600, 'auditoria');
    const [texto, , y] = chamadas.fillText[0];
    expect(texto).toBe('auditoria');
    expect(y).toBeGreaterThan(600);
    expect(y).toBeLessThan(600 + ALTURA_DA_TARJA);
  });

  it('texto claro sobre tarja escura, para ser legível impresso', () => {
    const { ctx, chamadas } = contextoFalso();
    desenharLegenda(ctx, 800, 600, 'x');
    expect(chamadas.cores[0]).toBe('#0A2647');
    expect(chamadas.cores[1]).toBe('#FFFFFF');
  });
});
