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

/**
 * Busca a NF-e no provedor externo por chave de acesso e importa pelo mesmo
 * caminho da importação manual. Faz polling de WAITING/SEARCHING a cada ~2s,
 * até 10 tentativas, antes de desistir com um erro claro.
 */
export async function fetchAndImportNfeByKey(
  invoiceKey: string,
  onAttempt?: (attempt: number, maxAttempts: number) => void,
): Promise<ImportResult> {
  const key = invoiceKey.trim();
  if (!isValidNfeAccessKey(key)) {
    throw new Error('Chave de acesso inválida. Informe os 44 dígitos da NF-e.');
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt + 1, MAX_ATTEMPTS);
    const result = await callFetchFunction(key);

    if (result.outcome === 'already_imported') {
      throw new NfeFetchByKeyError('Esta NF-e já foi importada.', result.invoice);
    }
    if (result.outcome === 'ok' && result.xml) {
      return importNfeXml(result.xml);
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error('O provedor demorou demais para responder. Tente novamente em instantes.');
}
