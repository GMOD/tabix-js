import eslint from '@eslint/js'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'webpack.config.js',
      'dist/*',
      'benchmarks/*',
      'esm/*',
      'esm_*/*',
      'profile*',
      'example/*',
      'eslint.config.mjs',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importPlugin.flatConfigs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      '@typescript-eslint/parameter-properties': 'error',
      'no-console': [
        'warn',
        {
          allow: ['error', 'warn'],
        },
      ],
      curly: 'error',
      'object-shorthand': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      semi: ['error', 'never'],
      'unicorn/number-literal-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/filename-case': 'off',
      // unicorn 72 dropped prevent-abbreviations in favor of name-replacements
      'unicorn/name-replacements': 'off',

      // new in unicorn 72, each off for a specific reason:
      // _parse implements `protected abstract _parse` in indexFile.ts, which a
      // `#private` field cannot do
      'unicorn/prefer-private-class-fields': 'off',
      // indexFile.ts memoizes the promise (`this.parseP ??= this._parse().catch()`);
      // awaiting it there would defeat the memoization
      'unicorn/prefer-await': 'off',
      // the byte-scanning loops in tabixIndexedFile.ts are indexed and inlined
      // deliberately; for-of/entries() and extracted functions cost throughput
      'unicorn/no-for-loop': 'off',
      'unicorn/no-break-in-nested-loop': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      // these push toward early-exit style, which this codebase avoids
      'unicorn/prefer-continue': 'off',
      'unicorn/no-useless-else': 'off',
      // csi.ts member order mirrors bam-js/src/csi.ts on purpose
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/prefer-code-point': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-deprecated': 'warn',

      'import-x/no-unresolved': 'off',
      'import-x/extensions': ['error', 'always', { ignorePackages: true }],
      'import-x/order': [
        'error',
        {
          named: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
          groups: [
            'builtin',
            ['external', 'internal'],
            ['parent', 'sibling', 'index', 'object'],
            'type',
          ],
        },
      ],
    },
  },
)
