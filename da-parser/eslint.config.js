/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import globals from 'globals';
import { defineConfig, globalIgnores } from '@eslint/config-helpers'
import { recommended, source, test } from '@adobe/eslint-config-helix';

export default defineConfig([
  globalIgnores([
    'coverage',
    'dist/*',
  ]),
  {
    languageOptions: {
      ...recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.es6,
        ...globals.node,
        __rootdir: true,
      },
    },
    rules: {
      'class-methods-use-this': 0,
      'import/prefer-default-export': 0,

      'indent': ['error', 2, {
        ignoredNodes: ['TemplateLiteral *'],
        SwitchCase: 1,
      }],

      'max-statements-per-line': ['error', { max: 2 }],

      'no-await-in-loop': 0,

      'no-param-reassign': [2, { props: false }],

      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_$|^e$',
        caughtErrorsIgnorePattern: '^_$|^e$',
        varsIgnorePattern: '^_$|^e$',
      }],

      'object-curly-newline': ['error', {
        multiline: true,
        minProperties: 6,
        consistent: true,
      }],
    },
    plugins: {
      import: recommended.plugins.import,
    },
    extends: [recommended],
  },
  source,
  test,
  {
    // Allow console in test files
    files: ['test/**/*.js'],
    rules: {
      'no-console': 'off',
      'no-unused-expressions': 0,
    },
  }
]);
