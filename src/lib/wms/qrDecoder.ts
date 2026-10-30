// Decodificar um QR a partir de um quadro de vídeo. Dois motores, uma interface.
//
// O Android (e o Chrome do computador) traz `BarcodeDetector` embutido: custa zero byte
// e roda fora da thread principal. O Safari do iPhone tem a API implementada mas
// DESLIGADA de fábrica até hoje — por isso existe o segundo caminho.
//
// O jsQR entra por `import()` dinâmico de propósito: vira um pedaço separado do pacote,
// baixado só por quem não tem a API nativa. Quem abre o sistema no computador nunca
// paga por ele.

export interface QrDecoder {
  /** Texto do QR no quadro atual, ou null quando não há QR nenhum à vista. */
  decode(video: HTMLVideoElement): Promise<string | null>;
  dispose(): void;
}

/** `BarcodeDetector` não está no lib.dom desta versão do TypeScript. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Acima disso a leitura fica mais cara sem ficar melhor: um QR de 3 cm a um palmo do
 *  celular já ocupa muito mais que o mínimo de pixels que o decodificador precisa. */
const MAX_SIDE = 640;

const nativeDecoder = async (): Promise<QrDecoder | null> => {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? [];
    if (!formats.includes('qr_code')) return null;
    const detector = new Ctor({ formats: ['qr_code'] });
    return {
      decode: async video => {
        try {
          const found = await detector.detect(video);
          return found[0]?.rawValue ?? null;
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

const fallbackDecoder = async (): Promise<QrDecoder> => {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d indisponível');

  return {
    decode: async video => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;

      const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // `dontInvert`: a etiqueta é preta sobre branco. Tentar o inverso a cada quadro
      // dobraria o custo para cobrir um caso que não existe nesta operação.
      const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      return found?.data ?? null;
    },
    dispose: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
};

export const createQrDecoder = async (): Promise<QrDecoder> =>
  (await nativeDecoder()) ?? (await fallbackDecoder());
