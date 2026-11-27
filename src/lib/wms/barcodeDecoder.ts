// Leitura de CÓDIGO DE BARRAS de produto (EAN-13, EAN-8, UPC, Code 128, Code 39).
//
// ── Por que não dá para usar o leitor de QR daqui ─────────────────────────────
// `qrDecoder.ts` pede `formats: ['qr_code']` ao `BarcodeDetector` e cai no jsQR, que
// decodifica QR e nada mais. Etiqueta de endereço é QR nosso e por ali está resolvido —
// mas a caixa do produto traz EAN-13, e separar às cegas depende de ler justamente essa
// etiqueta. Sem isto, conferir o produto seria digitar o SKU à mão no corredor.
//
// ── Por que o WASM, e por que só aqui ─────────────────────────────────────────
// No Android/Chrome o `BarcodeDetector` nativo já lê 1D: custa zero byte e é o caminho
// preferido. No iOS/Safari ele não existe — e é metade dos aparelhos de galpão. O
// zxing-wasm cobre esse buraco, mas são ~900 KB de WASM: entra por `import()` dinâmico,
// só quando a câmera de PRODUTO abre. Quem nunca separa, e a cena 3D, não pagam por ele.
//
// ── O WASM é servido pelo PRÓPRIO app ────────────────────────────────────────
// O padrão da biblioteca é buscar o `.wasm` num CDN. Dentro do galpão isso é um pedido
// a um terceiro no meio de um corredor com sinal ruim — exatamente onde a leitura não
// pode falhar. O `?url` do Vite copia o arquivo para o nosso bundle e o `locateFile`
// aponta para lá: mesma origem, mesmo cache do service worker, sem terceiro no caminho.

import type { QrDecoder } from './qrDecoder';

/** Acima disso a leitura fica mais cara sem ficar melhor. O mesmo teto do leitor de QR. */
const MAX_SIDE = 640;

/**
 * Formatos que uma caixa de produto carrega no Brasil.
 *
 * QR entra junto de propósito: há fornecedor que imprime QR com o GTIN dentro, e recusar
 * a leitura por causa do formato faria o operador digitar um código que a câmera já viu.
 */
const FORMATOS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF', 'QRCode'] as const;

/** `BarcodeDetector` não está no lib.dom desta versão do TypeScript. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Os mesmos formatos, no vocabulário do `BarcodeDetector` nativo. */
const FORMATOS_NATIVOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

const nativo = async (): Promise<QrDecoder | null> => {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;

  try {
    const suportados = (await Ctor.getSupportedFormats?.()) ?? [];
    const usaveis = FORMATOS_NATIVOS.filter(f => suportados.includes(f));
    // Só QR suportado significa um navegador que não lê 1D: cai para o WASM, senão a
    // câmera abriria e nunca reconheceria a etiqueta da caixa.
    if (usaveis.filter(f => f !== 'qr_code').length === 0) return null;

    const detector = new Ctor({ formats: usaveis });
    return {
      decode: async video => {
        try {
          const achados = await detector.detect(video);
          return achados[0]?.rawValue ?? null;
        } catch {
          // Quadro inválido no meio da troca de resolução. O próximo serve.
          return null;
        }
      },
      dispose: () => undefined,
    };
  } catch {
    return null;
  }
};

const porWasm = async (): Promise<QrDecoder> => {
  const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);

  prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d indisponível');

  return {
    decode: async video => {
      const largura = video.videoWidth;
      const altura = video.videoHeight;
      if (!largura || !altura) return null;

      const escala = Math.min(1, MAX_SIDE / Math.max(largura, altura));
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const quadro = ctx.getImageData(0, 0, canvas.width, canvas.height);
      try {
        const achados = await readBarcodes(quadro, { formats: [...FORMATOS], tryHarder: true });
        const valido = achados.find(a => a.isValid && a.text);
        return valido?.text ?? null;
      } catch {
        return null;
      }
    },
    dispose: () => undefined,
  };
};

/** Nativo quando o aparelho lê 1D; WASM quando não lê. */
export const createBarcodeDecoder = async (): Promise<QrDecoder> =>
  (await nativo()) ?? porWasm();
