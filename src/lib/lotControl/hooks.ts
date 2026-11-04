import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LOT_CONTROL, type LotControlSettings } from './lotControlDomain';
import { fetchLotControl } from './lotControlService';

export interface UseLotControl {
  settings: LotControlSettings;
  /** `false` enquanto a chave ainda não foi lida. O menu usa isto para não
   *  piscar uma aba que vai sumir no instante seguinte. */
  ready: boolean;
  reload: () => Promise<void>;
}

/** A chave de lote/validade da empresa.
 *
 *  Lida uma vez por carga e consultada por quem precisa decidir se mostra campo,
 *  aba ou aviso. Falha de leitura cai nos padrões — ou seja, DESLIGADO: num erro,
 *  a escolha segura é não exibir um recurso que a empresa talvez não use, e não
 *  exibir um que ela talvez não tenha ligado. */
export function useLotControl(companyId: string | undefined): UseLotControl {
  const [settings, setSettings] = useState<LotControlSettings>(DEFAULT_LOT_CONTROL);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) { setSettings(DEFAULT_LOT_CONTROL); setReady(true); return; }
    try {
      const { settings: lidas } = await fetchLotControl(companyId);
      setSettings(lidas);
    } catch (err) {
      console.error('[Lote/Validade] chave', err);
      setSettings(DEFAULT_LOT_CONTROL);
    } finally {
      setReady(true);
    }
  }, [companyId]);

  useEffect(() => { setReady(false); reload(); }, [reload]);

  return { settings, ready, reload };
}
