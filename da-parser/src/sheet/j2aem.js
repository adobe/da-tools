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

function formatSheetData(jData) {
  const data = jData.reduce((acc, row, idx) => {
    if (idx > 0) { // Skip header row
      const rowObj = {};
      row.forEach((value, rowIdx) => {
        if (jData[0][rowIdx]) { // jData[0] is header row
          rowObj[jData[0][rowIdx]] = value;
        }
      });
      acc.push(rowObj);
    }
    return acc;
  }, []);

  // Remove trailing empty rows
  while (data.length > 1 && !Object.values(data.slice(-1)[0]).some(Boolean)) {
    data.pop();
  }

  return data;
}

export function jSheetToAemJson(sheets) {
  const getSheetProps = (sheet) => {
    const data = formatSheetData(sheet.data);
    return {
      total: data.length,
      limit: data.length,
      offset: 0,
      data,
      ':colWidths': sheet.columns.map((col) => col.width),
    };
  };

  const { publicSheets, privateSheets } = sheets.reduce((acc, sheet) => {
    if (sheet.sheetName.startsWith('private-')) {
      acc.privateSheets[sheet.sheetName] = getSheetProps(sheet);
    } else {
      acc.publicSheets[sheet.sheetName] = getSheetProps(sheet);
    }
    return acc;
  }, { publicSheets: {}, privateSheets: {} });

  const publicNames = Object.keys(publicSheets);
  const privateNames = Object.keys(privateSheets);

  let json = {};
  if (publicNames.length > 1) {
    json = publicSheets;
    json[':names'] = publicNames;
    json[':version'] = 3;
    json[':type'] = 'multi-sheet';
  } else if (publicNames.length === 1) {
    const sheetName = publicNames[0];
    json = publicSheets[sheetName];
    json[':sheetname'] = sheetName;
    json[':type'] = 'sheet';
  }

  if (privateNames.length > 0) {
    json[':private'] = privateSheets;
  }
  return JSON.stringify(json);
}
