// Orquestração do processamento em lote (spec §9). Puro no sentido de que não
// sabe NADA de PDF — recebe uma função `process` (que é quem chama pdfLibOps/
// pdfRenderOps de verdade) e só garante duas coisas: uma falha isolada nunca
// para o lote, e o progresso é reportado item a item.
//
// Sequencial de propósito (concurrency default 1): a spec pede "processar
// progressivamente" para arquivos grandes — rodar tudo em paralelo é o jeito
// mais fácil de estourar memória com vários PDFs grandes ao mesmo tempo.

export interface BatchItem<T> {
  id: string;
  input: T;
  label: string;
}

export type BatchItemStatus = 'pending' | 'processing' | 'done' | 'error';

export interface BatchItemResult {
  id: string;
  label: string;
  status: BatchItemStatus;
  error?: string;
  outputName?: string;
  outputBytes?: Uint8Array;
}

export interface RunBatchOptions<T> {
  process: (item: BatchItem<T>) => Promise<{ outputName: string; outputBytes: Uint8Array }>;
  onProgress?: (result: BatchItemResult, completedCount: number, total: number) => void;
  concurrency?: number;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function runBatch<T>(items: Array<BatchItem<T>>, options: RunBatchOptions<T>): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = items.map(item => ({ id: item.id, label: item.label, status: 'pending' }));
  let completed = 0;

  await runWithConcurrency(items, Math.max(1, options.concurrency ?? 1), async (item, index) => {
    results[index] = { ...results[index], status: 'processing' };
    options.onProgress?.(results[index], completed, items.length);

    try {
      const { outputName, outputBytes } = await options.process(item);
      results[index] = { ...results[index], status: 'done', outputName, outputBytes };
    } catch (err) {
      results[index] = { ...results[index], status: 'error', error: err instanceof Error ? err.message : 'Falha inesperada ao processar este arquivo.' };
    }

    completed += 1;
    options.onProgress?.(results[index], completed, items.length);
  });

  return results;
}

export function failedItems<T>(items: Array<BatchItem<T>>, results: BatchItemResult[]): Array<BatchItem<T>> {
  const failedIds = new Set(results.filter(r => r.status === 'error').map(r => r.id));
  return items.filter(item => failedIds.has(item.id));
}
