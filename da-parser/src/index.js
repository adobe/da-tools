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

// Schema exports
export { getSchema, isKnownHTMLTag } from './doc/schema.js';

// Parser/conversion exports
export {
  aem2doc,
  doc2aem,
  tableToBlock,
  EMPTY_DOC,
} from './doc/parser.js';

export {
  json2doc,
  doc2json,
} from './sheet/parser.js';

export { yToJSheet } from './sheet/y2j.js';
export { jSheetToY, dataArrayToY } from './sheet/j2y.js';
export { MIN_DIMENSIONS as MIN_SHEET_DIMENSIONS } from './sheet/aem2j.js';

// Re-export y-prosemirror functions for consumers
export {
  prosemirrorToYXmlFragment,
  yDocToProsemirror,
} from 'y-prosemirror';
