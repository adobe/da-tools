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
import './object_hash.js';

export const HASH_LENGTH = 12;
export const ACCEPTED_KEY = 'acceptedHashes';
export const REJECTED_KEY = 'rejectedHashes';
export const ROLLOUT_BASE_KEY = 'rolloutbase';
export const ROLLOUT_ORDER_KEY = 'rolloutorder';

export const hashContent = (content) => globalThis.objectHash(content);
export const getDiffHash = (content) => hashContent(content).substring(0, HASH_LENGTH);
