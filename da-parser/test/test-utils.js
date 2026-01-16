/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Unified test utilities that work in both browser (wtr) and Node.js (mocha) environments.
 *
 * Usage:
 *   import { expect, readTestFile } from './test-utils.js';
 *
 * This allows the same test files to run in both environments,
 * testing both the DOMParser (browser) and hast-util-from-html (Node.js) code paths.
 */

// Detect environment
const isNode = typeof window === 'undefined';

// Re-export expect from chai (works in both environments)
// In browser: @esm-bundle/chai is loaded
// In Node.js: chai is loaded
let expect; // eslint-disable-line import/no-mutable-exports
if (isNode) {
  const chai = await import('chai');
  expect = chai.expect;
} else {
  const chai = await import('@esm-bundle/chai');
  expect = chai.expect;
}

/**
 * Read a test file - works in both browser and Node.js
 * @param {string} path - Path to file relative to test directory (e.g., './mocks/file.html')
 * @returns {Promise<string>} File contents
 */
async function readTestFile(path) {
  if (isNode) {
    const fs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    // Get the directory of the test file
    const dirname = nodePath.dirname(fileURLToPath(import.meta.url));
    const fullPath = nodePath.join(dirname, path);
    return fs.readFile(fullPath, 'utf-8');
  }
  // Browser: use @web/test-runner-commands
  const { readFile } = await import('@web/test-runner-commands');
  return readFile({ path });
}

export { expect, readTestFile, isNode };
