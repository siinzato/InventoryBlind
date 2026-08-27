// NF-e — Busca automática por chave de acesso (provedor externo via Edge
// Function nfe-fetch-by-key). Esta função só obtém o XML; a partir daí segue
// exatamente o mesmo caminho da importação manual (importNfeXml, em
// nfeService.ts) — parsing e vínculo produto-a-produto nunca são duplicados.

import { supabase } from '../supabase';
import { importNfeXml, type ImportResult } from './nfeService';
import type { NfeInvoice } from './nfeTypes';

export class NfeFetchByKeyError extends Error {
  existing?: NfeInvoice;
  constructor(message: string, existing?: NfeInvoice) {
    super(message);
    this.existing = existing;
  }
}

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 10;

export function isValidNfeAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key.trim());
}

interface FetchOutcome {
  outcome: 'already_imported' | 'waiting' | 'ok';
  invoice?: NfeInvoice;
  xml?: string;
  providerStatus?: string;
}

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // Corpo não era JSON.
    }
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 && !message.includes('non-2xx') ? message : fallback;
}

async function callFetchFunction(invoiceKey: string): Promise<FetchOutcome> {
  const { data, error } = await supabase.functions.invoke('nfe-fetch-by-key', {
    body: { invoiceKey },
  });
  if (error) {
    throw new Error(await readFunctionError(error, 'Não foi possível buscar a NF-e agora.'));
  }
  return data as FetchOutcome;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ProviderXmlResult {
  xml: string;
  /** Não-nulo quando esta chave já existe em nfe_invoices (domínio da Conferência
   *  por NF-e / compras). O XML já baixado naquela importação é reaproveitado —
   *  nunca uma nova chamada ao provedor — mas a nota de compra em si não é
   *  tocada por quem não pertence a esse domínio. */
  existingPurchaseInvoice: NfeInvoice | null;
}

/** Faz o polling de WAITING/SEARCHING a cada ~2s (até 10 tentativas) e devolve
 *  o XML puro — sem decidir o que fazer com ele. `fetchAndImportNfeByKey` e
 *  `fetchNfeXmlByKey` compartilham este núcleo; cada um decide separadamente
 *  se persiste como nota de compra ou não. */
async function pollProviderForXml(
  invoiceKey: string,
  onAttempt?: (attempt: number, maxAttempts: number) => void,
): Promise<ProviderXmlResult> {
  const key = invoiceKey.trim();
  if (!isValidNfeAccessKey(key)) {
    throw new Error('Chave de acesso inválida. Informe os 44 dígitos da NF-e.');
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt + 1, MAX_ATTEMPTS);
    const result = await callFetchFunction(key);

    if (result.outcome === 'already_imported') {
      if (!result.invoice?.raw_xml) {
        throw new Error('Não foi possível consultar a NF-e. Tente novamente.');
      }
      return { xml: result.invoice.raw_xml, existingPurchaseInvoice: result.invoice };
    }
    if (result.outcome === 'ok' && result.xml) {
      return { xml: result.xml, existingPurchaseInvoice: null };
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error('O provedor demorou demais para responder. Tente novamente em instantes.');
}

/**
 * Busca a NF-e no provedor externo por chave de acesso e importa pelo mesmo
 * caminho da importação manual. Faz polling de WAITING/SEARCHING a cada ~2s,
 * até 10 tentativas, antes de desistir com um erro claro.
 */
export async function fetchAndImportNfeByKey(
  invoiceKey: string,
  onAttempt?: (attempt: number, maxAttempts: number) => void,
): Promise<ImportResult> {
  const { xml, existingPurchaseInvoice } = await pollProviderForXml(invoiceKey, onAttempt);
  if (existingPurchaseInvoice) {
    throw new NfeFetchByKeyError('Esta NF-e já foi importada.', existingPurchaseInvoice);
  }
  return importNfeXml(xml);
}

/**
 * Busca só o XML da NF-e pela chave de acesso, no mesmo provedor/Edge Function
 * usado pela Conferência por NF-e — sem persistir em nfe_invoices. Para fluxos
 * que processam o XML por conta própria e não pertencem ao domínio de compras
 * (ex.: Nova Devolução), evitando misturar as duas listagens.
 */
export async function fetchNfeXmlByKey(
  invoiceKey: string,
  onAttempt?: (attempt: number, maxAttempts: number) => void,
): Promise<string> {
  const { xml } = await pollProviderForXml(invoiceKey, onAttempt);
  return xml;
}
