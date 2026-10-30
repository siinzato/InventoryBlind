// Guardas do que a câmera entrega.
//
// O leitor é a única parte do pulmão que recebe texto de fora sem ninguém digitar. Esta
// função é a peneira — e é a única parte da leitura que dá para testar sem aparelho.

import { describe, expect, it } from 'vitest';
import { binCodeFromScan } from '../binScan';
import { BIN_SCAN_PARAM } from '../../appRoutes';

describe('binCodeFromScan — a etiqueta do pulmão', () => {
  // O formato que a folha de etiquetas imprime. Se a etiqueta e o leitor divergirem,
  // é aqui que aparece: os dois leem a mesma constante.
  it('lê o código da URL que a própria etiqueta carrega', () => {
    const url = `https://inventoryblind.app/?${BIN_SCAN_PARAM}=PP-A01-N1`;
    expect(binCodeFromScan(url)).toBe('PP-A01-N1');
  });

  it('não se perde com outros parâmetros na URL', () => {
    expect(binCodeFromScan(`https://x.app/?utm=cartaz&${BIN_SCAN_PARAM}=PP-B02-N3&ref=1`)).toBe('PP-B02-N3');
  });

  it('normaliza para maiúscula, como o formulário faz', () => {
    expect(binCodeFromScan(`https://x.app/?${BIN_SCAN_PARAM}=pp-a01-n1`)).toBe('PP-A01-N1');
    expect(binCodeFromScan('pp-a01-n1')).toBe('PP-A01-N1');
  });

  it('aceita o código cru, para QR gerado fora do sistema', () => {
    expect(binCodeFromScan('  PP-C04-N2  ')).toBe('PP-C04-N2');
  });
});

describe('binCodeFromScan — o que NÃO pode virar endereço', () => {
  // O caso que motivou a peneira: sem ela, o campo de endereço receberia o site inteiro.
  it('URL sem o parâmetro da vaga é recusada, não vira texto no campo', () => {
    expect(binCodeFromScan('https://inventoryblind.app/')).toBeNull();
    expect(binCodeFromScan('https://algum-site.com/promo?id=9')).toBeNull();
  });

  it('parâmetro vazio é recusado', () => {
    expect(binCodeFromScan(`https://x.app/?${BIN_SCAN_PARAM}=`)).toBeNull();
  });

  it('texto livre, espaço no meio e vazio são recusados', () => {
    expect(binCodeFromScan('')).toBeNull();
    expect(binCodeFromScan('   ')).toBeNull();
    expect(binCodeFromScan('PP A01 N1')).toBeNull();
    expect(binCodeFromScan('rua 3, nível 2')).toBeNull();
  });

  it('não explode com URL malformada', () => {
    expect(binCodeFromScan('https://')).toBeNull();
  });

  // Documentando o limite: um EAN tem a mesma forma de um código de vaga, e esta função
  // não conhece a lista de endereços. Quem recusa é a tela ("Endereço não cadastrado"),
  // e depois dela a RPC. Nenhum movimento acontece.
  it('um EAN passa pela forma — e é barrado adiante, não aqui', () => {
    expect(binCodeFromScan('7891234567890')).toBe('7891234567890');
  });
});

// ── Folha de etiquetas ────────────────────────────────────────────────────────────────

// Esta guarda existe porque a folha já saiu em branco DUAS vezes, por motivos
// diferentes. Não há como imprimir num teste, então o que dá para travar é a regra de
// CSS que, faltando, reproduz a falha.
const PULMAO = Object.values(
  import.meta.glob('/src/components/wms/WmsPulmaoPage.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

describe('etiquetas do pulmão — o que faz a folha não sair em branco', () => {
  // `html, body { overflow-x: hidden; max-width: 100vw }` do index.css vale também na
  // paginação da impressão: o Chrome recorta o documento inteiro em uma página só.
  it('desfaz o recorte de overflow/max-width do app dentro do @media print', () => {
    const print = PULMAO.slice(PULMAO.indexOf('@media print'));
    expect(print).toContain('overflow: visible !important');
    expect(print).toContain('max-width: none !important');
  });

  // A primeira causa: o container pendurado dentro da árvore do React tinha ancestrais
  // escondidos pela regra que esconde os irmãos do body.
  it('o container de impressão é irmão do app, não filho dele', () => {
    expect(PULMAO).toContain("document.body.appendChild(root)");
    expect(PULMAO).toContain('body > *:not(#ib-wms-print-root)');
  });

  it('a etiqueta quebra o endereço em rua, módulo e nível', () => {
    expect(PULMAO).toContain('parseBinCode(bin.code)');
    for (const rotulo of ['>RUA<', '>MÓDULO<', '>NÍVEL<', '>ENDEREÇO<']) {
      expect(PULMAO).toContain(rotulo);
    }
  });

  // Fundo colorido só sai com "Gráficos de plano de fundo" marcado no diálogo. Texto
  // branco sobre fundo que não saiu seria etiqueta em branco de novo, só que pior:
  // silenciosa.
  it('o destaque do nível é borda, nunca texto claro sobre fundo', () => {
    const print = PULMAO.slice(PULMAO.indexOf('@media print'));
    const level = print.slice(print.indexOf('.ib-wms-level'));
    expect(level.slice(0, level.indexOf('}'))).toContain('border:');
    expect(print).not.toMatch(/\.ib-wms-level[^}]*color:\s*#fff/i);
  });
});
