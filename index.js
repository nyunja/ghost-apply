#!/usr/bin/env node
// ─────────────────────────────────────────────
//  JobTailor CLI — Main Entry Point
//  Usage:
//    node index.js analyze
//    node index.js apply
//    node index.js profile list
// ─────────────────────────────────────────────

import "dotenv/config";
import pc from "picocolors";
import { banner } from "./src/utils/display.js";
import { getProvider, getModel } from "./src/lib/llm/client.js";

import { cmdAnalyze } from "./src/commands/analyze.js";
import { cmdApply, cmdBatch } from "./src/commands/apply.js";
import { cmdProfile, cmdExportProfile, cmdGeneratePdf, cmdGenerateCoverLetterPdf } from "./src/commands/profile.js";
import { cmdHistory, cmdStats, cmdBlacklist, cmdConfig, cmdClearSession } from "./src/commands/misc.js";

function cmdHelp() {
  banner();
  const provider = getProvider();
  const model    = getModel();
  console.log(pc.dim(`  Active provider: ${pc.cyan(provider)} / ${pc.cyan(model)}\n`));
  console.log(pc.bold("  Commands:\n"));
  console.log(`  ${pc.cyan("analyze")} [url]              Analyze a JD (URL, paste, or file) and generate tailored CV`);
  console.log(`  ${pc.cyan("batch")} <file>              Apply to all jobs in a .txt file (one URL per line)`);
  console.log(`  ${pc.cyan("apply")} [url]               Full pipeline: scrape JD → tailor → fill form → submit`);
  console.log(`  ${pc.cyan("profile")} <sub>             Manage resume profiles (add / list / switch / delete)`);
  console.log(`  ${pc.cyan("config")}                    Switch AI provider (Claude ↔ Gemini) and model`);
  console.log(`  ${pc.cyan("generate-pdf")} <file>       Generate resume PDF from a tailored CV JSON`);
  console.log(`  ${pc.cyan("generate-cover-pdf")} <file>  Generate cover letter PDF from a cover-letter JSON`);
  console.log(`  ${pc.cyan("clear-session")}             Clear saved login cookies`);
  console.log(`  ${pc.cyan("history")}                   Show recent applications`);
  console.log(`  ${pc.cyan("stats")}                     Show application statistics`);
  console.log(`  ${pc.cyan("blacklist")}                 Add a company to your blacklist`);
  console.log(`  ${pc.cyan("help")}                      Show this help message`);
  console.log();
  console.log(pc.dim("  profile subcommands:"));
  console.log(pc.dim("  profile add <file>   Import a resume (.pdf or .txt) and extract a new profile"));
  console.log(pc.dim("  profile list         List all saved profiles"));
  console.log(pc.dim("  profile switch       Interactively set the active profile"));
  console.log(pc.dim("  profile delete       Remove a saved profile"));
  console.log();
  console.log(pc.dim("  apply flags:"));
  console.log(pc.dim("  --dry-run            Fill form but do NOT click Submit"));
  console.log(pc.dim("  --resume <path>      Path to PDF resume to upload"));
  console.log(pc.dim("  --cv <path>          Path to tailored CV JSON (skips AI step)"));
  console.log(pc.dim("  --proxy <url>        Proxy e.g. http://user:pass@host:port"));
  console.log();
  console.log(pc.dim("  Environment:"));
  console.log(pc.dim("  ANTHROPIC_API_KEY    Claude API key       (provider: claude)"));
  console.log(pc.dim("  GEMINI_API_KEY       Gemini API key       (provider: gemini)"));
  console.log(pc.dim("  OPENROUTER_API_KEY   OpenRouter API key   (provider: openrouter)"));
  console.log(pc.dim("  AI_PROVIDER          Override config: claude | gemini | openrouter"));
  console.log(pc.dim("  AI_MODEL             Override config model per-run"));
  console.log();
  console.log(pc.dim("  Data stored at: ~/.jobtailor/"));
  console.log();
}

// ── router ─────────────────────────────────
const cmd = process.argv[2] ?? "help";

switch (cmd) {
  case "analyze":        await cmdAnalyze();                             break;
  case "apply":          await cmdApply();                               break;
  case "batch":          await cmdBatch();                               break;
  case "profile":        await cmdProfile();                            break;
  case "config":         await cmdConfig();                             break;
  case "generate-pdf":        await cmdGeneratePdf();             break;
  case "generate-cover-pdf":  await cmdGenerateCoverLetterPdf();  break;
  case "clear-session":  cmdClearSession();                             break;
  case "history":        cmdHistory();                                  break;
  case "stats":          cmdStats();                                    break;
  case "blacklist":      await cmdBlacklist();                          break;
  case "help":
  default:               cmdHelp();
}
