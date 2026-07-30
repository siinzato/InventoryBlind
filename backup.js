import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

console.log('Iniciando o modo Hacker de extração... 🕵️‍♂️');

// 1. Lendo as chaves originais do arquivo .env
const envFile = fs.readFileSync('.env', 'utf-8');
const extractValue = (key) => {
  const line = envFile.split('\n').find(l => l.startsWith(key));
  return line ? line.split('=')[1].trim() : null;
};

const url = extractValue('VITE_SUPABASE_URL');
const key = extractValue('VITE_SUPABASE_ANON_KEY');

// 2. Conectando furtivamente no banco de dados do Bolt
const supabase = createClient(url, key);

async function fazerBackup(nomeDaTabela) {
  console.log(`\nBaixando dados da tabela: ${nomeDaTabela}...`);
  // Buscando TODOS os registros sem limite
  const { data, error } = await supabase.from(nomeDaTabela).select('*');

  if (error) {
    console.error(`Erro na tabela ${nomeDaTabela}:`, error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log(`A tabela ${nomeDaTabela} está vazia.`);
    return;
  }

  // 3. Transformando os dados brutos em formato de Planilha (CSV)
  const cabecalhos = Object.keys(data[0]).join(',');
  const linhas = data.map(linha =>
    Object.values(linha).map(valor => {
      if (valor === null || valor === undefined) return '';
      // Protege textos que tenham vírgulas para não quebrar a planilha
      return `"${String(valor).replace(/"/g, '""')}"`; 
    }).join(',')
  );

  const conteudoCsv = [cabecalhos, ...linhas].join('\n');
  const nomeDoArquivo = `backup_${nomeDaTabela}.csv`;

  // 4. Salvando o arquivo no sistema
  fs.writeFileSync(nomeDoArquivo, conteudoCsv);
  console.log(`✅ Sucesso! Foram extraídas ${data.length} linhas para o arquivo: ${nomeDoArquivo}`);
}

async function iniciar() {
  // Vamos puxar as duas tabelas principais do seu estoque
  await fazerBackup('products');
  await fazerBackup('inventory_brands');
  console.log('\n🎉 Extração concluída! Verifique a lista de arquivos à esquerda.');
}

iniciar();