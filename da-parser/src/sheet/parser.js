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

import { jSheetToY } from './j2y.js';
import { yToJSheet } from './y2j.js';
import { SHEET_TEMPLATE, aemJson2jSheets } from './aem2j.js';
import { jSheetToAemJson } from './j2aem.js';

const EMPTY_JSON = [{ ...SHEET_TEMPLATE }];

export function json2doc(json, ydoc) {
  const jsonToConvert = Object.keys(json ?? {}).length === 0 ? EMPTY_JSON : json;
  const sheets = aemJson2jSheets(jsonToConvert);
  const ySheets = jSheetToY(sheets, ydoc);
  return ySheets;
}

export function doc2json(yDoc) {
  const ysheets = yDoc.getArray('sheets');
  const sheets = yToJSheet(ysheets);

  return jSheetToAemJson(sheets);
}
