import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `.claude/worktrees` guarda copias inteiras do repo criadas por sessoes
  // paralelas do Claude. Sem este ignore o `eslint .` lintava a copia junto com o
  // codigo real e o total virava o dobro do que existe em `src`, o que torna o
  // numero inutil como criterio de aprovacao.
  { ignores: ['dist', '.claude/worktrees'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // O repo ja marca parametro intencionalmente nao usado com `_` (`_ctx`,
      // `_field`, `_match`). Sem este padrao a regra so os tolerava por acidente
      // de posicao — `args: 'after-used'` ignora o que vem antes de um parametro
      // usado, e acusava exatamente os mesmos `_` quando eram o ultimo ou o unico.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  }
);
