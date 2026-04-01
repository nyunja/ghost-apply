// ─────────────────────────────────────────────
//  profiles.js — Dynamic Profile Manager
//  Stores profiles as JSON in ~/.jobtailor/profiles/
//  Supports PDF, DOCX, DOC + TXT resume import via AI extraction
// ─────────────────────────────────────────────

import fs   from "fs";
import os   from "os";
import path from "path";

const PROFILES_DIR = path.join(os.homedir(), ".jobtailor", "profiles");
const CONFIG_FILE  = path.join(os.homedir(), ".jobtailor", "config.json");


function ensureDir() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// ── List all saved profiles ───────────────────────────────────────────────────
export function listProfiles() {
  ensureDir();
  return fs
    .readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const filePath = path.join(PROFILES_DIR, f);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        
        // Strict adherence to new schema
        const pi    = data.personalInfo || {};
        const label = data._label || pi.name || pi.title || f.replace(".json", "");

        return {
          id:       f.replace(".json", ""),
          label,
          category: data._category ?? "General",
          name:     pi.name || "",
          path:     filePath,
          data,
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

// ── Standardize a profile object to the unified schema ──────────────────────
export function standardizeProfile(data) {
  if (!data) return null;
  const standard = JSON.parse(JSON.stringify(data)); // Deep copy

  // Final Normalization Cleanup (URLs, Emails)
  if (standard.personalInfo) {
    const pi = standard.personalInfo;
    ["website", "linkedin", "github"].forEach(key => {
      if (pi[key] && typeof pi[key] === "string" && !pi[key].startsWith("http")) {
        pi[key] = "https://" + pi[key];
      }
    });
    if (pi.email) pi.email = pi.email.toLowerCase().trim();
  }

  return standard;
}

// ── Load a specific profile by id ────────────────────────────────────────────
export function loadProfile(id) {
  const filePath = path.join(PROFILES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Profile not found: ${id}`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return standardizeProfile(data);
}

// ── Save a profile to disk ───────────────────────────────────────────────────
export function saveProfile(label, category, data) {
  ensureDir();
  const base = label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  const id       = `${base}-${Date.now()}`;
  const filePath = path.join(PROFILES_DIR, `${id}.json`);
  const saved    = { ...data, _label: label, _category: category };
  fs.writeFileSync(filePath, JSON.stringify(saved, null, 2));
  return { id, filePath };
}

// ── Delete a profile ─────────────────────────────────────────────────────────
export function deleteProfile(id) {
  const filePath = path.join(PROFILES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Profile not found: ${id}`);
  fs.unlinkSync(filePath);
}

// ── Active profile tracking (stored in config.json) ──────────────────────────
export function getActiveProfileId() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).activeProfile ?? null;
  } catch { return null; }
}

export function setActiveProfileId(id) {
  let config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  }
  config.activeProfile = id;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ── Load the active profile (null if none exist) ──────────────────────────────
export function loadActiveProfile() {
  const profiles = listProfiles();
  if (!profiles.length) return null;

  const activeId = getActiveProfileId();
  if (activeId) {
    const found = profiles.find(p => p.id === activeId);
    if (found) return standardizeProfile(found.data);
  }
  // Fall back to the first profile
  return standardizeProfile(profiles[0].data);
}

import { preprocess } from "./parser/preprocessor.js";

// ── Parse a resume file into raw text ────────────────────────────────────────
export async function parseResumeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let rawText = "";

  if (ext === ".txt") {
    rawText = fs.readFileSync(filePath, "utf8");
  } else if (ext === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const buffer = fs.readFileSync(filePath);
    const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(" ") + "\n";
    }
    rawText = text;
  } else if (ext === ".docx" || ext === ".doc") {
    const mammoth = await import("mammoth");
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    rawText = result.value;
  } else {
    throw new Error(`Unsupported file type "${ext}". Supported: .pdf  .docx  .doc  .txt`);
  }

  return preprocess(rawText);
}

