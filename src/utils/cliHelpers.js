import fs from "fs";
import path from "path";
import { select, cancel } from "@clack/prompts";
import pc from "picocolors";
import { getProvider, getModel } from "../lib/llm/client.js";
import {
  listProfiles, loadProfile,
  getActiveProfileId, setActiveProfileId
} from "../services/profiles.js";
import { fmt } from "./display.js";

export async function resolveActiveProfile() {
  const profiles = listProfiles();
  if (!profiles.length) {
    console.log(fmt.warn("No profiles found. Run: node index.js profile add <resume.pdf>"));
    process.exit(1);
  }

  if (profiles.length === 1) {
    setActiveProfileId(profiles[0].id);
    return profiles[0].data;
  }

  const activeId = getActiveProfileId();
  if (activeId && profiles.find(p => p.id === activeId)) {
    const active = profiles.find(p => p.id === activeId);
    console.log(fmt.dim(`  Using profile: ${active.label}`));
    return active.data;
  }

  const chosen = await select({
    message: "Which profile do you want to use for this run?",
    options: profiles.map(p => ({
      value: p.id,
      label: `${p.label}  ${pc.dim("(" + p.category + ")")}`,
      hint:  p.name,
    })),
  });
  if (!chosen) { cancel("Cancelled."); process.exit(0); }
  setActiveProfileId(chosen);
  return loadProfile(chosen);
}

export function buildFilename(profile, analysis, type, ts) {
  const slug = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const title = s => (s || "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const pInfo   = profile.personalInfo ?? profile;
  const name    = title(pInfo.name);
  const company = title(analysis?.company);
  const role    = title(analysis?.jobTitle);
  const serial  = ts ?? Date.now();
  // directory base includes serial for tracking; pdf base is human-readable only
  const dirBase = [slug(pInfo.name), slug(analysis?.company), slug(analysis?.jobTitle), serial].filter(Boolean).join("_");
  const pdfBase = [name, company, role, type].filter(Boolean).join("_");
  return { dirBase, pdfBase };
}

export function requireApiKey() {
  const provider = getProvider();
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    console.log(fmt.err("GEMINI_API_KEY is not set."));
    console.log(fmt.dim('  export GEMINI_API_KEY="AIza..."'));
    process.exit(1);
  }
  if (provider === "claude" && !process.env.ANTHROPIC_API_KEY) {
    console.log(fmt.err("ANTHROPIC_API_KEY is not set."));
    console.log(fmt.dim('  export ANTHROPIC_API_KEY="sk-ant-..."'));
    process.exit(1);
  }
  if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    console.log(fmt.err("OPENROUTER_API_KEY is not set."));
    console.log(fmt.dim('  export OPENROUTER_API_KEY="sk-or-..."'));
    process.exit(1);
  }
  if (provider === "perplexity" && !process.env.PERPLEXITY_API_KEY) {
    console.log(fmt.err("PERPLEXITY_API_KEY is not set."));
    console.log(fmt.dim('  export PERPLEXITY_API_KEY="pplx-..."'));
    process.exit(1);
  }
}

export function providerLabel() {
  const model = getModel();
  // Shorten long model names for the spinner to prevent terminal wrapping
  const displayModel = model.length > 25 ? model.split('/').pop().slice(0, 22) + "..." : model;
  return pc.dim(`[${getProvider()} / ${displayModel}]`);
}

export function readJDFromFile(filePath) {
  try {
    return fs.readFileSync(path.resolve(filePath), "utf8").trim();
  } catch {
    return null;
  }
}
