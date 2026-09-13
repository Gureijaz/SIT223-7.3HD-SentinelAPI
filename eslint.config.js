'use strict';

const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['coverage/**', 'reports/**', 'dist/**', 'node_modules/**', 'data/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      // Maintainability rules the SonarCloud quality gate also reports on; keeping
      // them enforced locally means a failing gate is never a surprise at the
      // Code Quality stage.
      complexity: ['error', 12],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 80, skipComments: true, skipBlankLines: true }],
      'max-params': ['error', 4],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-return-await': 'error',
      'no-throw-literal': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      'max-lines-per-function': 'off',
    },
  },
];
