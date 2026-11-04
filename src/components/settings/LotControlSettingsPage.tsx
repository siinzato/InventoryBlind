import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Input, Notice, Page, PageHeader, Panel, PanelSection, SegmentedControl } from '../ui';
import {
  ALERT_DAYS_MAX, ALERT_DAYS_MIN, DEFAULT_LOT_CONTROL, normalizeLotControl,
  type LotControlSettings,
} from '../../lib/lotControl/lotControlDomain';
import { fetchLotControl, saveLotControl } from '../../lib/lotControl/lotControlService';

interface Props {
  companyId: string;
  /** Owner/admin/manager. Quem decide se a operação inteira passa a informar lote
   *  no recebimento não é quem recebe. */
  canManage: boolean;
  /** Avisa o resto do app que a chave mudou — o menu e o recebimento leem a mesma
   *  configuração e precisam acompanhar sem recarregar a página. */
  onChanged?: () => void;
}

export function LotControlSettingsPage({ companyId, canManage, onChanged }: Props) {
  const [atual, setAtual] = useState<LotControlSettings>(DEFAULT_LOT_CONTROL);
  const [rascunho, setRascunho] = useState<LotControlSettings>(DEFAULT_LOT_CONTROL);
  const [salvo, setSalvo] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { settings, saved } = await fetchLotControl(companyId);
      setAtual(settings);
      setRascunho(settings);
      setSalvo(saved);
    } catch (err) {
      console.error('[Lote/Validade] carregar', err);
      setErro('Não foi possível carregar a configuração agora.');
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const alterado = useMemo(
    () => JSON.stringify(normalizeLotControl(rascunho)) !== JSON.stringify(normalizeLotControl(atual)),
    [rascunho, atual]
  );

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const gravada = await saveLotControl(companyId, rascunho);
      setAtual(gravada);
      setRascunho(gravada);
      setSalvo(true);
      setAviso('Configuração salva.');
      onChanged?.();
    } catch (err) {
      console.error('[Lote/Validade] salvar', err);
      setErro('Não foi possível salvar. Verifique se você tem permissão de gestão.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações"
        title="Lote e validade"
        description="Liga o registro de lote e de data de validade no recebimento. Desligado, nada disso aparece para a sua equipe."
      />

      {erro && <Notice tone="danger">{erro}</Notice>}
      {aviso && <Notice tone="success">{aviso}</Notice>}
      {carregando && <Notice tone="neutral">Carregando configuração…</Notice>}

      {!carregando && (
        <Panel>
          <PanelSection>
            <p className="text-overline mb-1">O que cada chave liga</p>
            <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
              {salvo
                ? 'Configuração desta empresa.'
                : 'Esta empresa ainda não configurou nada — as duas opções estão desligadas.'}
              {' '}São duas chaves porque são dois problemas: <strong>lote</strong> responde
              “onde foi parar o que saiu daquela remessa” num recall; <strong>validade</strong>{' '}
              responde “o que vence primeiro”. Dá para usar uma sem a outra.
            </p>

            <div className="flex flex-wrap items-end gap-6">
              <div>
                <span className="mb-1.5 block text-xs text-fg-subtle">Registro de lote</span>
                {canManage ? (
                  <SegmentedControl
                    label="Registro de lote"
                    value={rascunho.lotEnabled ? 'on' : 'off'}
                    onChange={v => setRascunho(a => ({ ...a, lotEnabled: v === 'on' }))}
                    options={[{ value: 'off', label: 'Desligado' }, { value: 'on', label: 'Ligado' }]}
                  />
                ) : (
                  <p className="text-sm text-fg">{atual.lotEnabled ? 'Ligado' : 'Desligado'}</p>
                )}
              </div>

              <div>
                <span className="mb-1.5 block text-xs text-fg-subtle">Data de validade</span>
                {canManage ? (
                  <SegmentedControl
                    label="Data de validade"
                    value={rascunho.expiryEnabled ? 'on' : 'off'}
                    onChange={v => setRascunho(a => ({ ...a, expiryEnabled: v === 'on' }))}
                    options={[{ value: 'off', label: 'Desligado' }, { value: 'on', label: 'Ligado' }]}
                  />
                ) : (
                  <p className="text-sm text-fg">{atual.expiryEnabled ? 'Ligado' : 'Desligado'}</p>
                )}
              </div>

              {rascunho.expiryEnabled && canManage && (
                <label className="block">
                  <span className="mb-1.5 block text-xs text-fg-subtle">Avisar com antecedência de</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={ALERT_DAYS_MIN}
                    max={ALERT_DAYS_MAX}
                    className="w-28"
                    value={Number.isFinite(rascunho.expiryAlertDays) ? rascunho.expiryAlertDays : ''}
                    onChange={e => {
                      const n = Number(e.target.value);
                      setRascunho(a => ({ ...a, expiryAlertDays: Number.isFinite(n) ? n : Number.NaN }));
                    }}
                  />
                  <span className="mt-1 block text-xs text-fg-subtle">dias</span>
                </label>
              )}
            </div>

            {canManage && (
              <div className="mt-5">
                <Button onClick={salvar} disabled={salvando || !alterado}>
                  <Save size={16} /> {salvando ? 'Salvando…' : 'Salvar configuração'}
                </Button>
              </div>
            )}

            {!canManage && (
              <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                Só quem tem permissão de gestão altera estas chaves — elas mudam o que a
                equipe inteira precisa informar ao receber mercadoria.
              </p>
            )}
          </PanelSection>
        </Panel>
      )}

      {!carregando && (
        <Panel>
          <PanelSection>
            <p className="text-overline mb-1">O que acontece ao ligar</p>
            <ul className="space-y-2 text-xs leading-relaxed text-fg-subtle">
              <li>
                O endereçamento do recebimento passa a aceitar lote e validade em cada
                colocação — opcionais, nunca obrigatórios: a mercadoria que chega sem lote
                visível não pode ficar sem endereço por causa disso.
              </li>
              <li>
                Com validade ligada, aparece a aba <strong>Controle de Validade</strong> em
                Operações, listando o que vence, do mais urgente para o mais distante.
              </li>
              <li>
                Desligar não apaga nada do que já foi registrado — apenas para de pedir e de
                exibir. Religar devolve a lista como estava.
              </li>
            </ul>

            <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
              O que esta versão <strong>não</strong> faz: o saldo por endereço continua sem
              separar por lote. Sabe-se que um lote entrou num endereço e quando vence, mas
              depois de separar mercadoria o sistema não sabe quanto daquele lote restou, e a
              separação não tem como respeitar “vence primeiro, sai primeiro”.
            </p>
          </PanelSection>
        </Panel>
      )}
    </Page>
  );
}
