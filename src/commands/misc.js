import pc from "picocolors";
import { intro, outro, cancel, text, select } from "@clack/prompts";

import { banner, divider, fmt, printHistory } from "../utils/display.js";
import { getHistory, getStats, DAILY_LIMIT, addBlacklist, getConfig, saveConfig } from "../services/tracker.js";
import { clearAuthState } from "../lib/browser/applyAutomation.js";

export function cmdHistory() {
  banner();
  const apps = getHistory(25);
  printHistory(apps);
}

export function cmdStats() {
  banner();
  const s = getStats();
  divider("STATS");
  const todayBar = s.today >= DAILY_LIMIT
    ? pc.red(`${s.today}/${DAILY_LIMIT}  ⛔ limit reached`)
    : s.today >= DAILY_LIMIT - 3
      ? pc.yellow(`${s.today}/${DAILY_LIMIT}`)
      : pc.green(`${s.today}/${DAILY_LIMIT}`);
  console.log(`  Today              : ${todayBar}`);
  console.log(`  Total applications : ${pc.cyan(s.total)}`);
  console.log(`  This week          : ${pc.green(s.thisWeek)}`);
  console.log(`  Blacklisted cos.   : ${pc.red(s.blacklisted)}`);
  console.log();
}

export async function cmdBlacklist() {
  banner();
  const company = await text({
    message: "Company name to blacklist:",
    placeholder: "Acme Corp"
  });
  if (!company) { cancel("Cancelled."); return; }
  addBlacklist(company);
  outro(fmt.ok(`"${company}" added to blacklist.`));
}

export async function cmdConfig() {
  banner();
  intro(pc.cyan("  Configure AI Provider"));

  const current = getConfig();
  console.log(fmt.info(`Current: ${pc.cyan(current.provider)} / ${pc.cyan(current.model)}`));
  console.log();

  const provider = await select({
    message: "Choose AI provider:",
    options: [
      { value: "claude",      label: "Claude      (Anthropic)  — set ANTHROPIC_API_KEY" },
      { value: "gemini",      label: "Gemini      (Google)     — set GEMINI_API_KEY" },
      { value: "openrouter",  label: "OpenRouter  (multi-LLM)  — set OPENROUTER_API_KEY  ✦ free models available" },
      { value: "perplexity",  label: "Perplexity  (Sonar)      — set PERPLEXITY_API_KEY" },
    ],
  });
  if (!provider) { cancel("Cancelled."); return; }

  let model;
  if (provider === "claude") {
    model = await select({
      message: "Choose Claude model:",
      options: [
        { value: "claude-opus-4-5",            label: "claude-opus-4-5            (most capable)" },
        { value: "claude-3-5-sonnet-20241022", label: "claude-3-5-sonnet-20241022 (faster)" },
        { value: "claude-3-5-haiku-20241022",  label: "claude-3-5-haiku-20241022  (cheapest)" },
      ],
    });
  } else if (provider === "gemini") {
    model = await select({
      message: "Choose Gemini model:",
      options: [
        { value: "gemini-2.0-flash", label: "gemini-2.0-flash  (fast, cheap)" },
        { value: "gemini-1.5-pro",   label: "gemini-1.5-pro    (more capable)" },
        { value: "gemini-2.5-pro",   label: "gemini-2.5-pro    (most capable, slower)" },
      ],
    });
  } else if (provider === "perplexity") {
    model = await select({
      message: "Choose Perplexity model:",
      options: [
        { value: "sonar",               label: "sonar                (fast, web-grounded)" },
        { value: "sonar-pro",           label: "sonar-pro            (more capable, higher limits)" },
        { value: "sonar-reasoning",     label: "sonar-reasoning      (chain-of-thought reasoning)" },
        { value: "sonar-deep-research", label: "sonar-deep-research   (multi-step research tasks)" },
      ],
    });
  } else {
    model = await select({
      message: "Choose OpenRouter model (all marked :free have no token cost):",
      options: [
        { value: "qwen/qwen3.6-plus-preview:free",            label: "qwen/qwen3.6-plus-preview:free            (72B, best for YAML/JSON) ✅ recommended" },
        { value: "meta-llama/llama-3.3-70b-instruct:free",      label: "meta-llama/llama-3.3-70b-instruct:free     (70B, fast, great for JSON)" },
        { value: "nvidia/nemotron-3-super-120b-a12b:free",       label: "nvidia/nemotron-3-super-120b-a12b:free      (120B MoE, strong reasoning) ★" },
        { value: "google/gemini-2.0-flash-exp:free",             label: "google/gemini-2.0-flash-exp:free            (Flash, high output limit)" },
        { value: "google/gemma-3-27b-it:free",                   label: "google/gemma-3-27b-it:free                  (27B, 131K ctx, instruction-tuned)" },
        { value: "nousresearch/hermes-3-llama-3.1-405b:free",    label: "nousresearch/hermes-3-llama-3.1-405b:free   (405B, best free overall)" },
        { value: "meta-llama/llama-3.2-3b-instruct:free",        label: "meta-llama/llama-3.2-3b-instruct:free       (3B, lightest / fastest)" },
      ],
    });
  }
  if (!model) { cancel("Cancelled."); return; }

  saveConfig({ provider, model });

  const keyVar = { claude: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", perplexity: "PERPLEXITY_API_KEY" }[provider];
  outro(
    fmt.ok(`Saved — using ${pc.cyan(provider)} / ${pc.cyan(model)}\n`) +
    pc.dim(`  Make sure ${pc.yellow(keyVar)} is exported in your shell.`)
  );
}

export function cmdClearSession() {
  clearAuthState();
}
