// ─────────────────────────────────────────────
//  Display helpers — colours, boxes, dividers
// ─────────────────────────────────────────────

import pc from "picocolors";

export const fmt = {
  // ── text styles ──
  dim:      (s) => pc.dim(s),
  bold:     (s) => pc.bold(s),
  cyan:     (s) => pc.cyan(s),
  green:    (s) => pc.green(s),
  yellow:   (s) => pc.yellow(s),
  red:      (s) => pc.red(s),
  magenta:  (s) => pc.magenta(s),
  white:    (s) => pc.white(s),
  gray:     (s) => pc.gray(s),

  // ── prefixes ──
  ok:   (s) => `${pc.green("✔")} ${s}`,
  warn: (s) => `${pc.yellow("⚠")} ${s}`,
  err:  (s) => `${pc.red("✘")} ${s}`,
  info: (s) => `${pc.cyan("›")} ${s}`,
  bot:  (s) => `${pc.magenta("◆")} ${s}`,
};

export function banner() {
  console.log();
  console.log(pc.cyan(pc.bold("  ╔══════════════════════════════╗")));
  console.log(pc.cyan(pc.bold("  ║  ") + pc.white(pc.bold("JobTailor CLI")) + pc.dim("  v1.0.0       ") + pc.cyan(pc.bold("║"))));
  console.log(pc.cyan(pc.bold("  ║  ") + pc.dim("AI-Powered Career Agent     ") + pc.cyan(pc.bold("║"))));
  console.log(pc.cyan(pc.bold("  ╚══════════════════════════════╝")));
  console.log();
}

export function divider(label = "") {
  const line = "─".repeat(50);
  if (label) {
    const pad = Math.floor((50 - label.length - 2) / 2);
    console.log(pc.dim("─".repeat(pad) + " " + label + " " + "─".repeat(50 - pad - label.length - 2)));
  } else {
    console.log(pc.dim(line));
  }
}

export function scoreBar(score) {
  const filled = Math.round(score / 5);   // 20-char bar
  const empty  = 20 - filled;
  const color  = score >= 75 ? pc.green : score >= 50 ? pc.yellow : pc.red;
  return color("█".repeat(filled)) + pc.dim("░".repeat(empty)) + ` ${pc.bold(score + "%")}`;
}

export function printAnalysis(a) {
  console.log();
  divider("ANALYSIS");
  console.log(fmt.bold(`  ${a.jobTitle}`) + (a.company ? pc.dim(` @ ${a.company}`) : ""));
  console.log(`  Match  ${scoreBar(a.matchScore)}`);
  console.log();

  if (a.topKeywords?.length) {
    console.log(fmt.dim("  Keywords : ") + a.topKeywords.map(k => pc.cyan(k)).join(pc.dim(", ")));
  }
  if (a.missingSkills?.length) {
    console.log(fmt.dim("  Gaps     : ") + a.missingSkills.map(k => pc.red(k)).join(pc.dim(", ")));
  }
  if (a.strengths?.length) {
    console.log(fmt.dim("  Strengths: ") + a.strengths.map(k => pc.green(k)).join(pc.dim(", ")));
  }

  console.log();
  console.log(pc.dim("  ") + pc.italic(pc.white(a.summary)));
  console.log();
}

export function printCV(cv) {
  // Guard: --cv flag must point to a tailored CV JSON, not profile.json
  if (!cv.headline && !cv.summary && !cv.injectedBullets) {
    console.log(fmt.err(
      "The file passed to --cv doesn't look like a tailored CV.\n" +
      "  --cv expects the JSON output from 'node index.js analyze',\n" +
      "  not profile.json. Check ~/.jobtailor/outputs/ for saved CVs."
    ));
    process.exit(1);
  }

  divider("TAILORED CV");
  console.log();
  console.log(fmt.bold("  Headline"));
  console.log(pc.cyan("  " + (cv.headline ?? pc.dim("(none)"))));
  console.log();

  console.log(fmt.bold("  Summary"));
  (cv.summary ?? "").split(". ").filter(Boolean).forEach(s => {
    console.log(pc.dim("  • ") + pc.white(s.trim() + "."));
  });
  console.log();

  console.log(fmt.bold("  Bullet Rewrites"));
  cv.injectedBullets?.forEach((b, i) => {
    console.log(pc.dim(`\n  [${i + 1}]`));
    console.log(pc.red("  − ") + pc.dim(b.original));
    console.log(pc.green("  + ") + pc.white(b.tailored));
    console.log(pc.yellow("    ↳ ") + pc.dim(b.reason));
  });
  console.log();

  if (cv.coverLineSuggestion) {
    console.log(fmt.bold("  Cover Line"));
    console.log(pc.magenta('  "' + cv.coverLineSuggestion + '"'));
    console.log();
  }

  console.log(fmt.dim("  Keywords injected: ") + cv.keywordsInjected?.map(k => pc.magenta(k)).join(pc.dim(", ")));
  console.log();
}

export function printHistory(apps) {
  if (!apps.length) {
    console.log(fmt.dim("  No applications recorded yet."));
    return;
  }
  divider("RECENT APPLICATIONS");
  apps.forEach(a => {
    const date = new Date(a.appliedAt).toLocaleDateString();
    const score = a.matchScore ? pc.cyan(a.matchScore + "%") : pc.dim("–");
    console.log(`  ${pc.dim(date)}  ${pc.white(a.jobTitle ?? "–")} ${pc.dim("@")} ${pc.white(a.company ?? "–")}  ${score}  ${a.status === "applied" ? pc.green("applied") : pc.yellow(a.status)}`);
  });
  console.log();
}
