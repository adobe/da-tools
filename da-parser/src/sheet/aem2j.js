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

export const MIN_DIMENSIONS = 20;
export const SHEET_TEMPLATE = { minDimensions: [MIN_DIMENSIONS, MIN_DIMENSIONS], sheetName: 'data' };

function getSheetData(sheetData) {
  if (!sheetData?.length) return [[], []];
  const header = Object.keys(sheetData[0]).map((key) => key);
  const data = sheetData.reduce((acc, item) => {
    const values = Object.keys(item).map((key) => item[key]);
    acc.push(values);
    return acc;
  }, []);
  return [header, ...data];
}

function getSheet(json, sheetName) {
  const data = getSheetData(json.data);
  const templ = { ...SHEET_TEMPLATE };

  // Ensure data is padded to minDimensions
  const [minRows, minCols] = templ.minDimensions;

  // Pad rows
  while (data.length < minRows) {
    data.push([]);
  }

  // Pad columns in each row
  for (let i = 0; i < data.length; i += 1) {
    while (data[i].length < minCols) {
      data[i].push('');
    }
  }

  // Create columns array that matches the data width
  const numColumns = Math.max(minCols, data[0]?.length || 0);

  // Use existing colWidths where available, fill rest with default width
  const colWidths = json[':colWidths'] || [];
  const columns = new Array(numColumns).fill(null).map((_, i) => ({
    width: colWidths[i] || '50',
  }));

  return {
    ...templ,
    sheetName,
    data,
    columns,
  };
}

export function aemJson2jSheets(json) {
  const sheets = [];

  // Single sheet
  if (json[':type'] === 'sheet') {
    sheets.push(getSheet(json, json[':sheetname'] || 'data'));
  }

  // Multi sheet
  const names = json[':names'];
  if (names) {
    names.forEach((sheetName) => {
      sheets.push(getSheet(json[sheetName], sheetName));
    });
  }

  const privateSheets = json[':private'];
  if (privateSheets) {
    Object.keys(privateSheets).forEach((sheetName) => {
      sheets.push(getSheet(privateSheets[sheetName], sheetName));
    });
  }

  return sheets;
}
