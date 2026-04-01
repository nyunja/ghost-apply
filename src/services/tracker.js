// ─────────────────────────────────────────────
//  Local tracker  (applications, blacklist, config)
//  Uses plain JSON files — no native deps.
// ─────────────────────────────────────────────

import fs   from "fs";
import path from "path";
import os   from "os";

const DATA_DIR   = path.join(os.homedir(), ".jobtailor");
const DB_PATH     = path.join(DATA_DIR, "db.json");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

// ── Config (AI provider preference) ──────────

export function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { provider: "claude", model: "claude-opus-4-5" };
  }
}

export function saveConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function load() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { applications: [], blacklist: [] };
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function isBlacklisted(company) {
  const db = load();
  return db.blacklist.some(
    b => b.toLowerCase() === (company ?? "").toLowerCase()
  );
}

export function alreadyApplied(jobTitle, company) {
  const db = load();
  return db.applications.some(
    a =>
      a.jobTitle?.toLowerCase() === jobTitle?.toLowerCase() &&
      a.company?.toLowerCase() === (company ?? "").toLowerCase()
  );
}

export function recordApplication(entry) {
  const db = load();
  db.applications.unshift({ ...entry, appliedAt: new Date().toISOString() });
  save(db);
}

export function addBlacklist(company) {
  const db = load();
  if (!isBlacklisted(company)) db.blacklist.push(company);
  save(db);
}

export function getHistory(limit = 20) {
  return load().applications.slice(0, limit);
}

export const DAILY_LIMIT = 10;

/** ISO date string for today in local time, e.g. "2026-03-25" */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** How many applications have been recorded today. */
export function todayCount() {
  const today = todayStr();
  return load().applications.filter(a => (a.appliedAt ?? "").startsWith(today)).length;
}

/**
 * Call before any action that records an application.
 * Throws a RangeError if the daily cap has been reached.
 */
export function checkDailyLimit() {
  const count = todayCount();
  if (count >= DAILY_LIMIT) {
    throw new RangeError(
      `Daily limit reached — ${count}/${DAILY_LIMIT} applications recorded today. ` +
      `Come back tomorrow or adjust DAILY_LIMIT in tracker.js.`
    );
  }
}

export function getStats() {
  const db = load();
  return {
    total:       db.applications.length,
    blacklisted: db.blacklist.length,
    thisWeek:    db.applications.filter(a => {
      const d = new Date(a.appliedAt);
      return (Date.now() - d) < 7 * 86400 * 1000;
    }).length,
    today:       todayCount(),
  };
}
