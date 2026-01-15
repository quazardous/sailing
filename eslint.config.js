import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import nPlugin from 'eslint-plugin-n';
import sonarjs from 'eslint-plugin-sonarjs';
import prettierConfig from 'eslint-config-prettier';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', '**/*.js'],
  },

  ...tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      n: nPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // ══════════════════════════════════════════════════════════════════════
      // OFF - Not applicable for Unix CLI
      // ══════════════════════════════════════════════════════════════════════
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // ══════════════════════════════════════════════════════════════════════
      // ERRORS - Real bugs, fix these
      // ══════════════════════════════════════════════════════════════════════
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ══════════════════════════════════════════════════════════════════════
      // WARNINGS - Fix progressively
      // ══════════════════════════════════════════════════════════════════════
      // Any-related (root cause = no-explicit-any)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Code quality - unused imports (auto-fixable)
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',

      // SonarJS
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/prefer-regexp-exec': 'warn',
      'sonarjs/unused-import': 'off', // handled by unused-imports plugin
      'sonarjs/no-dead-store': 'warn',
      'sonarjs/slow-regex': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-ignored-exceptions': 'warn',

      // Node plugin
      ...nPlugin.configs.recommended.rules,
      'n/no-missing-import': 'off',
      'n/no-process-exit': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/hashbang': 'off',

      // Import plugin
      'import/no-unresolved': 'off',
      'import/no-named-as-default-member': 'off',

      ...prettierConfig.rules,
    },
  },
);
