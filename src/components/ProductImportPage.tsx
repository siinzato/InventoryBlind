// Product Import Page Component - Full Featured

import React, { useState, useCallback, useMemo } from 'react';
import { FileSpreadsheet, ArrowLeft, Lock, XCircle, Package } from 'lucide-react';
import { ProductUploadArea } from './ProductUploadArea';
import { ColumnMappingWizard } from './ColumnMappingWizard';
import { ProductImportPreview } from './ProductImportPreview';
import { ProductImportProgress } from './ProductImportProgress';
import { ProductImportSummary } from './ProductImportSummary';
import { Page, PageHeader, Panel, PanelSection, Button, PhaseRail } from './ui';
import type { PhaseRailStep } from './ui';
import type { ProductValidated, ImportSummary, ImportProgress, ImportError, ImportStatus, ColumnMapping, ProductFromDB } from '../lib/productImportTypes';
import {
  parseCSV,
  processRawProducts,
  calculateImportSummary,
} from '../lib/productImportUtils';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { classifyCompanyProducts } from '../lib/productBrands/productBrandService';
import { syncActiveCycleItems } from '../lib/inventoryCycle/inventoryCycleService';

interface ProductImportPageProps {
  onBack: () => void;
  isAdmin: boolean;
  onRequestAdmin: () => void;
}

const IMPORT_PHASES: PhaseRailStep[] = [
  { key: 'upload', label: 'Enviar' },
  { key: 'mapping', label: 'Mapear' },
  { key: 'preview', label: 'Revisar' },
  { key: 'importing', label: 'Importar' },
  { key: 'complete', label: 'Concluido' },
];

export const ProductImportPage: React.FC<ProductImportPageProps> = ({
  onBack,
  isAdmin,
  onRequestAdmin,
}) => {
  // Mesmo identificador de empresa nas duas pontas: inventory_brands.company_id é text e
  // product_brands/product_lines.company_id é uuid, mas o valor é o mesmo — o contexto de auth
  // já entrega o companyId ativo (que respeita a troca de workspace).
  const { profile, companyId } = useAuth();

  const [status, setStatus] = useState<ImportStatus>('upload');
  const [isReading, setIsReading] = useState(false);
  const [products, setProducts] = useState<ProductValidated[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [dbErrors, setDbErrors] = useState<ImportError[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({
    current: 0,
    total: 0,
    percentage: 0,
    status: 'idle',
    message: '',
  });
  const [existingProducts, setExistingProducts] = useState<Map<string, ProductFromDB>>(new Map());

  // File data
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<{ [key: string]: string | number | undefined }>>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);

  // Load existing products from database.
  // Paginated with .range() — a single unbounded .select() is silently capped
  // (PostgREST/Supabase default row limit, ~1000) and any product past that
  // cutoff would be wrongly treated as "new" below, causing duplicate-key
  // failures on insert for SKUs that already exist in the database.
  const loadExistingProducts = async (): Promise<Map<string, ProductFromDB>> => {
    const PAGE_SIZE = 1000;
    const productsMap = new Map<string, ProductFromDB>();
    try {
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, sku, ean, location, price, created_at, updated_at, company_id')
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;

        data?.forEach((item: ProductFromDB) => {
          productsMap.set(item.sku.toUpperCase(), item);
        });

        const pageLength = data?.length ?? 0;
        if (pageLength < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return productsMap;
    } catch (err) {
      console.error('Error loading existing products:', err);
      return productsMap;
    }
  };

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    // Check admin
    if (!isAdmin) {
      alert('Voce precisa estar logado como admin para importar produtos.');
      onRequestAdmin();
      return;
    }

    setIsReading(true);
    setStatus('upload');

    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let headers: string[] = [];
      let rows: Array<{ [key: string]: string | number | undefined }> = [];
      let content = '';

      if (extension === 'csv') {
        content = await file.text();
        const parsed = parseCSV(content);
        headers = parsed.headers;
        rows = parsed.rows;
      } else {
        // Parse Excel
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        content = jsonData.map(row => (row as string[]).join(';')).join('\n');

        if (jsonData.length > 0) {
          headers = (jsonData[0] as string[]).map(String);
          rows = (jsonData.slice(1) as string[][]).map(row => {
            const obj: { [key: string]: string | number | undefined } = {};
            headers.forEach((header, idx) => {
              obj[header] = row[idx];
            });
            return obj;
          });
        }
      }

      if (rows.length === 0) {
        alert('Nenhuma linha encontrada na planilha.');
        setIsReading(false);
        return;
      }

      setCurrentFile(file);
      setFileContent(content);
      setRawHeaders(headers);
      setRawRows(rows);
      setIsReading(false);
      setStatus('mapping');
    } catch (err) {
      console.error('Error reading file:', err);
      alert('Erro ao ler o arquivo.');
      setStatus('upload');
    }

    setIsReading(false);
  }, [isAdmin, onRequestAdmin]);

  // Handle column mapping confirmation
  const handleMappingConfirm = useCallback(async (mapping: ColumnMapping) => {
    setColumnMapping(mapping);
    setStatus('validating');

    // Load existing products
    const existing = await loadExistingProducts();
    setExistingProducts(existing);

    // Process with mapping (async, chunked to avoid blocking UI)
    const { products: validated, errors: importErrors } = await processRawProducts(rawRows, existing, mapping);

    const nonEmptyEntries = validated.filter(p =>
      p.sku?.trim() || p.name?.trim()
    );

    setProducts(nonEmptyEntries);
    setErrors(importErrors);
    setSummary(calculateImportSummary(nonEmptyEntries));
    setStatus('preview');
  }, [rawRows]);

  // Confirm import
  const handleConfirmImport = useCallback(async () => {
    if (!summary || summary.validProducts === 0 || !columnMapping || !isAdmin) return;

    setStatus('importing');
    setDbErrors([]);
    const executionErrors: ImportError[] = [];
    const validProducts = products.filter(p => p.isValid);
    const total = validProducts.length;

    setProgress({
      current: 0,
      total,
      percentage: 0,
      status: 'importing',
      message: 'Criando registro de importacao...',
    });

    let imported = 0;
    let newCount = 0;
    let updateCount = 0;
    let importRecordId: string | null = null;

    // Create import history record first
    try {
      importRecordId = await createImportHistory();

      if (!importRecordId) {
        // Fallback: continue without history record
        console.warn('[handleConfirmImport] Sem registro de historico, continuando sem auditoria');
      }
    } catch (err: any) {
      console.error('[handleConfirmImport] Erro ao criar historico:', err);
      // Fallback: ask user if they want to continue
      const continueWithoutHistory = confirm(
        `Nao foi possivel criar o registro de importacao no historico.\n\nErro: ${err?.message || 'Desconhecido'}\n\nDeseja continuar mesmo assim? (Os produtos serao importados, mas sem historico)`
      );
      if (!continueWithoutHistory) {
        setStatus('preview');
        return;
      }
    }

    const batchSize = 50;
    const batches = Math.ceil(total / batchSize);

    for (let i = 0; i < batches; i++) {
      const batch = validProducts.slice(i * batchSize, (i + 1) * batchSize);

      const newProducts = batch.filter(p => p.isNew);
      const updateProducts = batch.filter(p => !p.isNew);

      // Insert new products
      if (newProducts.length > 0) {
        const insertData = newProducts.map(p => ({
          name: p.name,
          sku: p.sku,
          ean: p.ean || null,
          location: p.location || null,
          price: p.price || null,
        }));

        const { data: insertedProducts, error: insertError } = await supabase
          .from('products')
          .insert(insertData)
          .select('id, sku');

        if (insertError) {
          console.error('[handleConfirmImport] Erro ao inserir produtos:', insertError);
          newProducts.forEach(p => {
            executionErrors.push({
              row: 0,
              sku: p.sku || undefined,
              name: p.name || undefined,
              error: insertError.message || 'Erro ao salvar produto no banco de dados',
            });
          });
        }

        if (!insertError && insertedProducts) {
          // Record audit only if we have import record
          if (importRecordId) {
            for (const inserted of insertedProducts) {
              const product = newProducts.find(p => p.sku === inserted.sku);
              if (product) {
                try {
                  await supabase.from('import_products_audit').insert({
                    import_id: importRecordId,
                    product_id: inserted.id,
                    sku: product.sku,
                    action: 'insert',
                    old_data: null,
                    new_data: { name: product.name, sku: product.sku, ean: product.ean, location: product.location, price: product.price },
                  });
                } catch (auditErr) {
                  console.warn('[handleConfirmImport] Erro ao registrar auditoria:', auditErr);
                }
              }
            }
          }
          imported += newProducts.length;
          newCount += newProducts.length;
        }
      }

      // Update existing products
      for (const product of updateProducts) {
        const oldProduct = existingProducts.get(product.sku.toUpperCase());

        if (oldProduct) {
          const { error: updateError } = await supabase
            .from('products')
            .update({
              name: product.name,
              ean: product.ean || null,
              location: product.location || null,
              price: product.price || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', oldProduct.id);

          if (updateError) {
            console.error('[handleConfirmImport] Erro ao atualizar produto:', updateError);
            executionErrors.push({
              row: 0,
              sku: product.sku || undefined,
              name: product.name || undefined,
              error: updateError.message || 'Erro ao atualizar produto no banco de dados',
            });
          }

          if (!updateError) {
            // Record audit only if we have import record
            if (importRecordId) {
              try {
                await supabase.from('import_products_audit').insert({
                  import_id: importRecordId,
                  product_id: oldProduct.id,
                  sku: product.sku,
                  action: 'update',
                  old_data: { name: oldProduct.name, sku: oldProduct.sku, ean: oldProduct.ean, location: oldProduct.location, price: oldProduct.price },
                  new_data: { name: product.name, sku: product.sku, ean: product.ean, location: product.location, price: product.price },
                });
              } catch (auditErr) {
                console.warn('[handleConfirmImport] Erro ao registrar auditoria:', auditErr);
              }
            }
            imported++;
            updateCount++;
          }
        }
      }

      // Update progress
      const current = Math.min((i + 1) * batchSize, total);
      setProgress({
        current,
        total,
        percentage: Math.round((current / total) * 100),
        status: 'importing',
        message: `Processando ${current} de ${total} produtos...`,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Update import history only if we have a record
    if (importRecordId) {
      try {
        await supabase
          .from('import_history')
          .update({
            total_products: imported,
            new_products: newCount,
            updated_products: updateCount,
            errors: errors.length + executionErrors.length,
            status: 'completed',
          })
          .eq('id', importRecordId);
      } catch (updateErr) {
        console.warn('[handleConfirmImport] Erro ao atualizar historico:', updateErr);
      }
    }

    // Classificação Marca > Linha e reconciliação do inventário ativo. Vem DEPOIS de os
    // produtos estarem gravados (o classificador precisa dos ids) e antes de a tela declarar
    // a importação concluída — era exatamente esta etapa que faltava: SKU novo entrava no
    // catálogo e nunca aparecia como pendente, deixando a linha em 100% sem ter sido contada.
    //
    // `onlyUnclassified` preenche o que falta sem reprocessar o que já está resolvido, e
    // curadoria manual nunca é sobrescrita. Falha aqui não invalida a importação: os produtos
    // já estão salvos, então isto vira aviso, não erro.
    if (companyId) {
      try {
        setProgress({
          current: total, total, percentage: 100, status: 'importing',
          message: 'Classificando marcas e linhas...',
        });
        await classifyCompanyProducts(companyId, profile?.id ?? '', profile?.email ?? '', { onlyUnclassified: true });
        await syncActiveCycleItems(companyId, profile?.id ?? null);
      } catch (syncErr) {
        console.warn('[handleConfirmImport] Classificação/reconciliação não concluída:', syncErr);
        executionErrors.push({
          row: 0,
          error: 'Produtos importados, mas a classificação por marca/linha e a atualização das pendências do inventário não foram concluídas. Reprocesse em Produtos → Linhas e Marcas.',
        });
      }
    }

    setSummary(prev => prev ? {
      ...prev,
      newProducts: newCount,
      updateProducts: updateCount,
      importedCount: imported,
    } : null);

    setDbErrors(executionErrors);

    if (executionErrors.length > 0) {
      setProgress({
        current: total,
        total,
        percentage: 100,
        status: 'error',
        message: 'Importação concluída com falhas.',
      });
      setStatus('error');
    } else {
      setProgress({
        current: total,
        total,
        percentage: 100,
        status: 'completed',
        message: 'Importacao concluida!',
      });
      setStatus('complete');
    }
  }, [products, summary, columnMapping, isAdmin, existingProducts, errors.length, companyId, profile?.id, profile?.email]);

  // Create import history record
  const createImportHistory = async (): Promise<string | null> => {
    if (!currentFile) {
      console.error('[createImportHistory] Nenhum arquivo selecionado');
      return null;
    }

    console.log('[createImportHistory] Criando registro de importacao...');
    console.log('[createImportHistory] Arquivo:', currentFile.name);
    console.log('[createImportHistory] Tamanho:', currentFile.size);
    console.log('[createImportHistory] Mapeamento:', columnMapping);

    // Prepare insert data - avoid large file_content
    const insertData: Record<string, any> = {
      file_name: currentFile.name,
      file_size: currentFile.size,
      total_products: 0,
      new_products: 0,
      updated_products: 0,
      errors: 0,
      imported_by: 'admin',
      status: 'processing',
    };

    // Only add file_content if it's small (less than 500KB)
    if (fileContent.length < 500000) {
      insertData.file_content = fileContent;
    } else {
      console.log('[createImportHistory] Arquivo muito grande, nao sera salvo no historico');
    }

    // Only add column_mapping if it exists and is valid
    if (columnMapping) {
      insertData.column_mapping = columnMapping;
    }

    console.log('[createImportHistory] Dados do insert (resumidos):', {
      file_name: insertData.file_name,
      file_size: insertData.file_size,
      status: insertData.status,
      has_file_content: !!insertData.file_content,
      has_column_mapping: !!insertData.column_mapping,
    });

    try {
      const { data, error } = await supabase
        .from('import_history')
        .insert(insertData)
        .select('id')
        .single();

      if (error) {
        console.error('[createImportHistory] Erro do Supabase:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      console.log('[createImportHistory] Registro criado com sucesso:', data?.id);
      return data?.id || null;
    } catch (err: any) {
      console.error('[createImportHistory] Erro completo:', err);
      // Show user-friendly error
      const errorMsg = err?.message || 'Erro desconhecido';
      const errorCode = err?.code || '';
      const errorHint = err?.hint || '';

      alert(`Erro ao criar registro de importacao: ${errorMsg}\n\nCodigo: ${errorCode}\nDica: ${errorHint}\n\nVerifique o console para mais detalhes.`);
      return null;
    }
  };

  // Reset state
  const handleReset = useCallback(() => {
    setStatus('upload');
    setIsReading(false);
    setProducts([]);
    setErrors([]);
    setDbErrors([]);
    setSummary(null);
    setProgress({
      current: 0,
      total: 0,
      percentage: 0,
      status: 'idle',
      message: '',
    });
    setCurrentFile(null);
    setFileContent('');
    setRawHeaders([]);
    setRawRows([]);
    setColumnMapping(null);
  }, []);

  const handleCancel = useCallback(() => {
    handleReset();
  }, [handleReset]);

  // Admin check overlay
  const AdminCheckOverlay = () => (
    <div className="rounded-container border border-amber-500/20 bg-amber-500/10 p-8 text-center">
      <Lock size={32} className="mx-auto mb-3 text-amber-600 dark:text-amber-400" />
      <h3 className="text-title mb-2">Acesso Restrito</h3>
      <p className="text-sm text-fg-muted mb-6">
        Somente administradores podem importar produtos.
      </p>
      <Button onClick={onRequestAdmin}>
        Fazer Login como Admin
      </Button>
    </div>
  );

  // Import completed with database execution errors
  const ImportErrorResult = () => (
    <div>
      <div className="text-center mb-8">
        <XCircle size={32} className="mx-auto mb-3 text-red-600 dark:text-red-400" />
        <h2 className="text-title mb-2">
          Importação concluída com falhas
        </h2>
        <p className="text-sm text-fg-muted">
          Alguns produtos não foram salvos no banco de dados. Veja os detalhes abaixo.
        </p>
      </div>

      <Panel className="mb-8">
        <PanelSection>
          <div className="grid grid-cols-2 divide-x divide-edge">
            <div className="text-center px-4">
              <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{summary?.importedCount ?? 0}</p>
              <p className="text-sm text-fg-muted mt-1">Salvos com sucesso</p>
            </div>
            <div className="text-center px-4">
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">{dbErrors.length}</p>
              <p className="text-sm text-fg-muted mt-1">Falharam ao salvar</p>
            </div>
          </div>
        </PanelSection>

        <PanelSection>
          <p className="text-section mb-3">Produtos não salvos</p>
          <ul className="divide-y divide-edge/60 max-h-64 overflow-y-auto">
            {dbErrors.map((err, idx) => (
              <li key={idx} className="py-2 text-sm">
                <span className="font-medium text-fg">{err.sku || 'SKU não informado'}</span>
                {err.name ? <span className="text-fg-subtle"> — {err.name}</span> : null}
                <p className="text-red-600 dark:text-red-400">{err.error}</p>
              </li>
            ))}
          </ul>
        </PanelSection>
      </Panel>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Button onClick={onBack} variant="secondary">
          <Package size={20} />
          Ver Produtos
        </Button>
        <Button onClick={handleReset} variant="primary">
          <FileSpreadsheet size={20} />
          Nova Importação
        </Button>
      </div>
    </div>
  );

  return (
    <Page>
      <PageHeader
        title="Importar Produtos"
        description="Importe sua planilha de produtos para o sistema"
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {/* Fases da importação */}
        <PhaseRail
          label="Progresso da importação"
          steps={IMPORT_PHASES}
          currentKey={status === 'error' ? 'complete' : status}
          className="mb-8"
        />

        {/* Content */}
        {!isAdmin ? (
          <AdminCheckOverlay />
        ) : (
          <>
            {status === 'upload' && (
              <ProductUploadArea
                onFileSelect={handleFileSelect}
                isLoading={isReading}
              />
            )}

            {status === 'mapping' && rawHeaders.length > 0 && (
              <ColumnMappingWizard
                headers={rawHeaders}
                sampleRows={rawRows}
                onConfirm={handleMappingConfirm}
                onCancel={handleCancel}
              />
            )}

            {status === 'preview' && summary && (
              <ProductImportPreview
                products={products}
                summary={summary}
                onConfirm={handleConfirmImport}
                onCancel={handleCancel}
                isImporting={false}
                errors={errors}
              />
            )}

            {status === 'importing' && (
              <ProductImportProgress progress={progress} />
            )}

            {status === 'complete' && summary && (
              <ProductImportSummary
                summary={summary}
                onViewProducts={onBack}
                onNewImport={handleReset}
              />
            )}

            {status === 'error' && (
              <ImportErrorResult />
            )}
          </>
        )}
    </Page>
  );
};
