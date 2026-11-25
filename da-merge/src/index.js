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
import createRegionalDiff from './regional-diff.js';
import createSmartOverwrite from './smart-overwrite.js';
import createApplyCopy from './apply-copy.js';
import { diffSummary } from './markup.js';

export {
  LOC_MARKERS, isSnapshotPath, removeLocTags,
} from './regional-diff.js';
export {
  DA_METADATA_SELECTOR, REVIEW_KEYS, readMetadata, getRolloutBase, formatRolloutBase,
  formatRolloutOrder, readRolloutOrder, isEmptyMain, withMetadataRow, withBaselineRow,
  countLocalBlocks, MAX_UNITS,
} from './smart-overwrite.js';
export {
  BEHAVIORS, OUTCOME, CANONICALIZE_LOSS, toPageHtml,
} from './apply-copy.js';
export { REASON } from './markup.js';
export {
  HASH_LENGTH, ACCEPTED_KEY, REJECTED_KEY, ROLLOUT_BASE_KEY, ROLLOUT_ORDER_KEY,
  hashContent, getDiffHash,
} from './hashes.js';
export { default as threeWayMerge } from './smart-merge.js';
export { default as getElementMetadata } from './metadata.js';

export default class DaMerge {
  constructor({
    DOMParser, Node, document, canonicalize,
  } = {}) {
    if (!DOMParser || !Node || !document || typeof canonicalize !== 'function') {
      throw new TypeError('DaMerge requires DOMParser, Node, document, and canonicalize');
    }
    this.parser = new DOMParser();
    const regional = createRegionalDiff({ document });
    const smart = createSmartOverwrite({ Node, regional });
    const parse = (html) => this.parse(html);
    Object.assign(this, regional, smart, createApplyCopy({
      parse, canonicalize, regional, smart,
    }));
  }

  parse(html) {
    const [, head, body] = (!/<(html|head)[\s>]/i.test(html)
      && html.match(/^([\s\S]*?)(<body[\s>][\s\S]*)$/i)) || [];
    const inner = head?.trim() ? `<head>${head}</head>${body}` : html;
    const text = /<html[\s>]/i.test(html) ? html : `<html>${inner}</html>`;
    const doc = this.parser.parseFromString(text, 'text/html');
    const doctype = /^\s*<!doctype/i.test(html);
    doc.sourceShape = { html: doctype || /<(html|head)[\s>]/i.test(html), doctype };
    return doc;
  }

  diffSummary(html) {
    return diffSummary(this.parse(html));
  }
}
