import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Fallback de rota para a hospedagem estática.
 *
 * O app usa URLs reais (`/app/dashboard`, `/app/operacoes/pulmao`) resolvidas no
 * NAVEGADOR. Clicar pelo menu funciona porque não há requisição ao servidor — mas digitar
 * a URL, dar F5 ou abrir um link direto bate no servidor, que procura um arquivo naquele
 * caminho, não acha, e devolve 404. Era o que acontecia em produção com TODA seção.
 *
 * O Static Web Server (usado pelo Wasmer Edge) entrega `404.html` quando o caminho não
 * existe. Publicando uma cópia do `index.html` com esse nome, o app carrega normalmente e
 * o roteador assume a partir da URL — que é o comportamento esperado de uma SPA.
 *
 * Fica FORA do precache do PWA de propósito: é um espelho do index, e duplicá-lo no
 * service worker só inflaria o cache sem servir para nada.
 */
function spaFallback(): Plugin {
  return {
    name: 'ib-spa-fallback',
    apply: 'build',
    // `closeBundle` roda depois de o bundle estar escrito em disco — inclusive depois do
    // PWA, que é o que mantém o 404.html fora do manifesto de precache.
    closeBundle() {
      const dist = resolve(process.cwd(), 'dist');
      const index = resolve(dist, 'index.html');
      if (existsSync(index)) copyFileSync(index, resolve(dist, '404.html'));
    },
  };
}

/**
 * Fim de linha estável nas leituras `?raw`.
 *
 * Os testes de guarda leem migrations e fontes com `import.meta.glob(..., '?raw')` e
 * comparam o conteúdo com regex. No Git o arquivo é gravado com LF, mas o checkout no
 * Windows (`core.autocrlf`) entrega CRLF — então qualquer regex que atravesse uma quebra
 * de linha passa no Linux e falha no Windows, sem nada de errado no código testado.
 *
 * Normalizar na leitura faz o teste comparar com o conteúdo canônico do repositório, que
 * é o que ele quer afirmar, em vez de um artefato de como a máquina fez o checkout.
 *
 * `apply: 'serve'` mantém isto fora do build de produção. Hoje é irrelevante — nada no
 * app usa `?raw`, só os testes —, mas garante que um `?raw` futuro em código de produção
 * receba o arquivo exatamente como está em disco.
 */
function rawEolNormalize(): Plugin {
  return {
    name: 'ib-raw-eol-normalize',
    apply: 'serve',
    enforce: 'pre',
    load(id) {
      const [file, query] = id.split('?');
      if (query == null || !/(^|&)raw(&|$)/.test(query)) return null;
      if (!existsSync(file)) return null;
      return `export default ${JSON.stringify(
        readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      )};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5174,
    host: true,
    strictPort: true,
  },

  plugins: [
    react(),

    spaFallback(),

    rawEolNormalize(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png'
      ],

      manifest: {
        name: 'InventoryBlind',
        short_name: 'InventoryBlind',
        description: 'Inteligência para inventários, estoque e gestão operacional',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        theme_color: '#0F3D68',
        background_color: '#0F3D68',

        icons: [
          {
            src: '/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
        ],
      },

      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,woff2}'
        ],
        // O mapa 3D arrasta three/fiber/drei: sozinho ele é ~919 kB, mais de 10% de
        // tudo que o app precarrega. Deixá-lo no precache cobraria esse download na
        // INSTALAÇÃO de todo mundo, inclusive de quem nunca abre a seção 3D — e o
        // coletor no corredor é justamente quem menos tem banda sobrando.
        //
        // A troca: o mapa 3D passa a exigir rede na primeira abertura. É aceitável
        // porque ele é uma visão de planejamento, não um passo da operação de
        // contagem; o mapa 2D do Pulmão continua precarregado e funciona offline.
        //
        // O padrão do Workbox também descartaria silenciosamente qualquer arquivo
        // acima de 2 MiB. Preferível excluir por nome, de propósito, a esbarrar nesse
        // teto um dia sem perceber.
        globIgnores: ['**/Warehouse3DViewer-*.js'],
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },

      devOptions: {
        enabled: false,
      },
    }),
  ],

  optimizeDeps: {
    exclude: ['lucide-react'],
    include: [
      'gsap',
      'gsap/ScrollTrigger',
      '@gsap/react',
      'motion/react'
    ],
  },

  build: {
    chunkSizeWarningLimit: 700,
  },
});