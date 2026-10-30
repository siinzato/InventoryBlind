// A câmera lendo o QR da vaga, dentro do app.
//
// Por que existe, se a câmera nativa do celular já abre o sistema pelo adesivo: porque
// ela só resolve o PRIMEIRO endereço. Numa transferência o operador está parado na
// frente da origem e precisa do destino; numa sequência de vagas ele teria que sair do
// app, abrir a câmera e voltar, uma vez por endereço.
//
// Este componente não movimenta nada e não conhece saldo. Ele devolve uma string e
// fecha — o mesmo que o teclado entrega. Tudo depois disso é o caminho que já roda em
// produção, e quem valida o endereço continua sendo o banco.

import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button, Modal, Notice } from '../ui';
import { binCodeFromScan } from '../../lib/wms/binScan';
import { createQrDecoder, type QrDecoder } from '../../lib/wms/qrDecoder';

/** ~8 leituras por segundo. Acompanha a mão do operador e deixa o celular respirar;
 *  a cada quadro (60/s) só esquentaria o aparelho. */
const SCAN_INTERVAL_MS = 120;

const cameraProblem = (err: unknown): string => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permissão de câmera negada. Libere o acesso nas configurações do navegador e tente de novo — ou digite o endereço.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Nenhuma câmera encontrada neste aparelho. Digite o endereço.';
  }
  if (name === 'NotReadableError') {
    return 'A câmera está ocupada por outro aplicativo. Feche-o e tente de novo.';
  }
  return 'Não foi possível abrir a câmera. Digite o endereço.';
};

/** Confirmação discreta de leitura: um toque curto e um bipe baixo. Tudo opcional —
 *  aparelho sem vibração ou com áudio bloqueado apenas não dá o retorno. */
const signalRead = (): void => {
  try {
    navigator.vibrate?.(40);
  } catch {
    /* alguns navegadores declaram e recusam */
  }
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const audio = new Ctor();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1_320;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    osc.onended = () => { audio.close().catch(() => undefined); };
    osc.start();
    osc.stop(audio.currentTime + 0.07);
  } catch {
    /* som é cortesia, não requisito */
  }
};

export function WmsBinScanner({
  open,
  title,
  onClose,
  onDetected,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [problem, setProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // `onDetected` chega nova a cada render do formulário. Na lista de dependências do
  // efeito, isso desligaria e religaria a câmera a cada tecla digitada atrás do modal.
  const detectedRef = useRef(onDetected);
  useEffect(() => { detectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    // Capturado uma vez: o elemento já está montado quando o efeito roda (o modal
    // renderiza o conteúdo junto com `open`), e na limpeza o ref pode já ter sido solto.
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let done = false;
    let stream: MediaStream | null = null;
    let decoder: QrDecoder | null = null;
    let frame = 0;
    let lastRun = 0;

    setStatus('starting');
    setProblem(null);
    setHint(null);

    const fail = (message: string) => {
      if (cancelled) return;
      setProblem(message);
      setStatus('error');
    };

    const tick = (now: number) => {
      if (cancelled || done) return;
      frame = requestAnimationFrame(tick);
      if (now - lastRun < SCAN_INTERVAL_MS) return;
      lastRun = now;

      if (!decoder || video.readyState < 2) return;

      decoder
        .decode(video)
        .then(text => {
          if (cancelled || done || !text) return;
          const code = binCodeFromScan(text);
          if (!code) {
            // Segue lendo: o operador pode ter pego a etiqueta errada de raspão.
            setHint('Este QR não é de um endereço do pulmão.');
            return;
          }
          done = true;
          signalRead();
          detectedRef.current(code);
        })
        .catch(() => undefined);
    };

    void (async () => {
      if (!window.isSecureContext) {
        fail('A câmera só abre em conexão segura (https). Digite o endereço.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('Este navegador não dá acesso à câmera. Digite o endereço.');
        return;
      }

      try {
        // `ideal` e não `exact`: num tablet sem câmera traseira, `exact` falharia em vez
        // de usar a que existe.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        fail(cameraProblem(err));
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay recusado: o elemento volta a tentar sozinho */
      }

      try {
        decoder = await createQrDecoder();
      } catch {
        fail('Não foi possível iniciar a leitura neste aparelho. Digite o endereço.');
        return;
      }
      if (cancelled) return;

      setStatus('scanning');
      frame = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      decoder?.dispose();
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-3">
        {status === 'error' ? (
          <Notice tone="warning">{problem}</Notice>
        ) : (
          <>
            <div className="relative aspect-[3/4] overflow-hidden rounded-container bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-container border-2 border-white/70" />
              </div>
              {status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
                  Abrindo a câmera...
                </div>
              )}
            </div>
            <p className="text-caption text-center">Aponte para o QR colado na vaga.</p>
            {hint && <Notice tone="warning">{hint}</Notice>}
          </>
        )}

        <Button variant="secondary" onClick={onClose} className="w-full">
          <Keyboard size={16} />
          Digitar o endereço
        </Button>
      </div>
    </Modal>
  );
}
