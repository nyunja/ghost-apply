// ─────────────────────────────────────────────
//  selectors.js — Multi-Platform Selector Cache
//  Learns and persists successful UI selectors.
//  Structure: { "greenhouse.io": { actions: {apply: "..."}, fields: {linkedin: "..."} } }
// ─────────────────────────────────────────────

import fs from "fs";
import path from "path";
import os from "os";

const STORAGE = path.join(os.homedir(), ".jobtailor", "selectors.json");

const KNOWN_PLATFORMS = [
  "greenhouse.io", "lever.co", "workday.com", "ashbyhq.com",
  "workable.com", "smartrecruiters.com", "taleo.net", "icims.com",
];

/** Load all learned selectors from disk. */
export function loadSelectors() {
  if (!fs.existsSync(STORAGE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORAGE, "utf8"));
  } catch { return {}; }
}

/** Save all selectors to disk. */
function saveSelectors(data) {
  const dir = path.dirname(STORAGE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORAGE, JSON.stringify(data, null, 2));
}

/** Resolve the key to use for storage (platform-level vs. exact hostname). */
function resolveKey(hostname) {
  const matched = KNOWN_PLATFORMS.find(p => hostname.endsWith(p));
  return matched ?? hostname;
}

/**
 * Get a selector by hostname and name.
 * @param {string} hostname  e.g. "job-boards.greenhouse.io"
 * @param {string} name      action name (e.g. "apply") or field name (e.g. "linkedin")
 * @param {"actions"|"fields"} category  defaults to "actions" for backward-compat.
 */
export function getSelector(hostname, name, category = "actions") {
  const cache = loadSelectors();

  // Check exact host first, then platform-level key
  for (const key of [hostname, resolveKey(hostname)]) {
    const entry = cache[key];
    if (!entry) continue;

    // Nested format: { actions: {…}, fields: {…} }
    if (entry[category]?.[name]) return entry[category][name];

    // Backward-compat: flat format { apply: "…" } → treated as "actions"
    if (category === "actions" && typeof entry[name] === "string") return entry[name];
  }
  return null;
}

/**
 * Store a successful selector for a domain.
 * @param {string} hostname
 * @param {string} name      action or field name
 * @param {string} selector  CSS selector that worked
 * @param {"actions"|"fields"} category
 */
export function setSelector(hostname, name, selector, category = "actions") {
  const cache = loadSelectors();
  const key = resolveKey(hostname);

  if (!cache[key]) cache[key] = { actions: {}, fields: {} };

  // Migrate flat format to nested if needed
  if (typeof cache[key].actions === "undefined") {
    const { actions: _a, fields: _f, ...flat } = cache[key];
    cache[key] = { actions: { ...flat }, fields: {} };
  }
  if (!cache[key].actions) cache[key].actions = {};
  if (!cache[key].fields) cache[key].fields = {};

  cache[key][category][name] = selector;
  saveSelectors(cache);
}

/**
 * Remove a selector (mark for re-learning).
 */
export function removeSelector(hostname, name, category = "actions") {
  const cache = loadSelectors();
  const key = resolveKey(hostname);
  if (cache[key]?.[category]?.[name]) {
    delete cache[key][category][name];
    saveSelectors(cache);
  }
  // Backward-compat flat
  if (category === "actions" && cache[key]?.[name]) {
    delete cache[key][name];
    saveSelectors(cache);
  }
}
