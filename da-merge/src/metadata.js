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
function joinContent(first, other) {
  const merged = first.cloneNode(true);
  merged.append(first.ownerDocument.createTextNode(','), ...[...other.childNodes]
    .map((node) => node.cloneNode(true)));
  return merged;
}

export default function getElementMetadata(el) {
  if (!el) return {};
  return [...el.childNodes].reduce((rdx, row) => {
    if (row.children) {
      const spelled = row.children[0].textContent.trim();
      const key = spelled.toLowerCase();
      const first = rdx[key];
      const content = first && row.children[1]
        ? joinContent(first.content, row.children[1]) : row.children[1];
      const text = content?.textContent.trim().toLowerCase();
      if (key && content) rdx[key] = { content, text, key: first?.key ?? spelled };
    }
    return rdx;
  }, {});
}
