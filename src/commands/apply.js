import fs from "fs";
import path from "path";
import os from "os";
import pc from "picocolors";
import { intro, outro, text, confirm, spinner, note, cancel } from "@clack/prompts";

import { analyzeJD } from "../services/ai/jobAnalysis.js";
import { tailorCV } from "../services/ai/resumeTailoring.js";
import { generateCoverLetter } from "../services/ai/coverLetter.js";
import { answerFormQuestions } from "../services/ai/formQuestions.js";
import { resolveActiveProfile, requireApiKey, providerLabel, buildFilename } from "../utils/cliHelpers.js";
import { exploreJob, getQuestionsFromManifest } from "../lib/browser/explorer.js";
import { applyToJob } from "../lib/browser/applyAutomation.js";
import { recordApplication, checkDailyLimit, getStats, DAILY_LIMIT } from "../services/tracker.js";
import { banner, fmt, printAnalysis, printCV } from "../utils/display.js";
import { cmdGeneratePdf, cmdGenerateCoverLetterPdf } from "./profile.js";

// ── Core per-job pipeline ─────────────────────────────────────────────────────
// Returns "applied" | "skipped" | "error"
export async function applySingleJob(url, profile, opts = {}) {
  const { dryRun = false, resumePath = null, proxyOpts = null, cvFilePath = null } = opts;

  let tailoredCV, analysis, manifest, jd;

  if (cvFilePath) {
    try {
      tailoredCV = JSON.parse(fs.readFileSync(path.resolve(cvFilePath), "utf8"));
      console.log(fmt.ok("Loaded tailored CV from " + cvFilePath));
    } catch {
      console.log(fmt.err("Could not read CV file: " + cvFilePath));
      return "error";
    }
  } else {
    const s0 = spinner();
    s0.start("Exploring job listing...");
    try {
      manifest = await exploreJob(url);
      jd = manifest.jd;
      s0.stop(fmt.ok(`Explored ${jd.length} chars + ${manifest.steps.length} steps from ${new URL(url).hostname}`));
    } catch (err) {
      s0.stop(fmt.err("Exploration failed: " + err.message));
      return "error";
    }

    const s = spinner();
    s.start(`Analyzing JD + tailoring CV ${providerLabel()}...`);
    try {
      analysis   = await analyzeJD(jd, profile);
      tailoredCV = await tailorCV(analysis, profile);
      s.stop(fmt.ok("Match: " + analysis.matchScore + "%"));
    } catch (err) {
      s.stop(fmt.err("AI step failed: " + err.message));
      return "error";
    }

    printAnalysis(analysis);

    if (analysis.matchScore < 40) {
      const go = await confirm({ message: `Low match (${analysis.matchScore}%). Apply anyway?` });
      if (!go) return "skipped";
    }
  }

  printCV(tailoredCV);

  // Save application files
  const baseDir = path.join(os.homedir(), ".jobtailor", "applications");
  const ts      = Date.now();
  const { dirBase, pdfBase } = buildFilename(profile, analysis, null, ts);
  const appDir  = path.join(baseDir, dirBase || `job-${ts}`);
  fs.mkdirSync(appDir, { recursive: true });

  fs.writeFileSync(path.join(appDir, "jd.json"), JSON.stringify({
    url, company: analysis?.company, role: analysis?.jobTitle,
    timestamp: new Date(ts).toISOString(), analysis
  }, null, 2));

  const cvJsonPath = path.join(appDir, `${pdfBase}_CV.json`);
  fs.writeFileSync(cvJsonPath, JSON.stringify(tailoredCV, null, 2));

  // Cover letter + PDFs
  let coverLetter = null;
  const s1 = spinner();
  s1.start(`Generating cover letter ${providerLabel()}...`);
  try {
    const clData    = await generateCoverLetter(analysis, profile, tailoredCV);
    coverLetter     = clData;
    const clJsonPath = path.join(appDir, `${pdfBase}_Cover-Letter.json`);
    fs.writeFileSync(clJsonPath, JSON.stringify(clData, null, 2));
    s1.stop(fmt.ok("Cover letter ready."));
    await cmdGeneratePdf(cvJsonPath, path.join(appDir, `${pdfBase}_CV.pdf`));
    await cmdGenerateCoverLetterPdf(clJsonPath, path.join(appDir, `${pdfBase}_Cover-Letter.pdf`));
  } catch (err) {
    s1.stop(fmt.warn("Cover letter failed: " + err.message.split("\n")[0]));
  }

  if (coverLetter?.coverLetter?.content) {
    const { opening, body, closing } = coverLetter.coverLetter.content;
    note(pc.cyan([opening, ...body, closing].join("\n\n")), "📄 Cover Letter Preview");
  }

  // Pre-fetch form answers
  let preAnswers = [];
  if (manifest?.steps.length) {
    const formQs = getQuestionsFromManifest(manifest);
    if (formQs.length) {
      const s3 = spinner();
      s3.start(`Generating answers to ${formQs.length} form question(s) ${providerLabel()}...`);
      try {
        const responses = await answerFormQuestions(formQs, profile, tailoredCV);
        preAnswers = responses.questionResponses?.mappedAnswers || [];
        s3.stop(fmt.ok(`Pre-generated ${preAnswers.length} answer(s).`));
        fs.writeFileSync(path.join(appDir, "application-responses.json"), JSON.stringify(responses, null, 2));
        if (preAnswers.length) {
          const qaLines = preAnswers
            .map(({ question, answer }) => `${pc.dim("Q:")} ${question.label}\n  ${pc.cyan("A:")} ${answer}`)
            .join("\n");
          note(qaLines, "📋 Form Answers");
        }
      } catch (err) {
        s3.stop(fmt.warn("Answer generation failed: " + err.message.split("\n")[0]));
      }
    }
  }

  // Human Guard
  note(
    pc.yellow("Review the tailored content above.\n") +
    pc.dim("The browser will open and fill these details.\n") +
    (dryRun ? pc.green("DRY RUN — Submit will NOT be clicked.") : pc.red("LIVE — Submit WILL be clicked.")),
    "Human Guard"
  );

  const proceed = await confirm({
    message: dryRun ? "Open browser in dry-run mode?" : "Open browser and submit?"
  });
  if (!proceed) return "skipped";

  console.log(fmt.info("Browser opening — watch the window..."));
  let result;
  try {
    result = await applyToJob(url, tailoredCV, profile, {
      dryRun, resumePath, proxy: proxyOpts, headless: false, appDir,
      coverLetter: coverLetter?.coverLetter?.content
        ? [coverLetter.coverLetter.content.opening, ...coverLetter.coverLetter.content.body, coverLetter.coverLetter.content.closing].join("\n\n")
        : undefined,
      preAnswers,
    });
  } catch (err) {
    console.log(fmt.err("Browser error: " + err.message));
    return "error";
  }

  if (result.success && !result.dryRun) {
    recordApplication({
      jobTitle:   analysis?.jobTitle ?? url,
      company:    analysis?.company  ?? "Unknown",
      matchScore: analysis?.matchScore,
      status:     "applied",
      url,
    });
    console.log(fmt.ok("Logged to application tracker."));
  }

  return result.dryRun ? "skipped" : "applied";
}

// ── Single job command ────────────────────────────────────────────────────────
export async function cmdApply() {
  requireApiKey();
  try { checkDailyLimit(); } catch (err) {
    banner();
    console.log(fmt.err(err.message));
    process.exit(1);
  }
  banner();
  intro(pc.cyan("  Apply to a Job"));

  const profile    = await resolveActiveProfile();
  const args       = process.argv.slice(3);
  const dryRun     = args.includes("--dry-run");
  const resumeIdx  = args.indexOf("--resume");
  const resumePath = resumeIdx !== -1 ? args[resumeIdx + 1] : null;
  const proxyIdx   = args.indexOf("--proxy");
  const proxyStr   = proxyIdx  !== -1 ? args[proxyIdx  + 1] : null;
  const cvFileIdx  = args.indexOf("--cv");
  const cvFilePath = cvFileIdx !== -1 ? args[cvFileIdx + 1] : null;

  let url = args.find(a => a.startsWith("http"));
  if (!url) {
    url = await text({
      message: "Job listing URL:",
      placeholder: "https://jobs.lever.co/company/job-id",
      validate: v => v.startsWith("http") ? undefined : "Must be a full URL"
    });
    if (!url) { cancel("Cancelled."); return; }
  }

  let proxyOpts;
  if (proxyStr) {
    try {
      const u = new URL(proxyStr);
      proxyOpts = { server: `${u.protocol}//${u.hostname}:${u.port}`, username: u.username, password: u.password };
    } catch { console.log(fmt.warn("Could not parse proxy URL — ignoring")); }
  }

  const status = await applySingleJob(url, profile, { dryRun, resumePath, proxyOpts, cvFilePath });
  outro(
    status === "applied" ? pc.cyan("Application submitted! Good luck!") :
    status === "skipped" ? pc.yellow("Skipped.") :
    pc.red("Finished with errors — check last_action.png")
  );
}

// ── Batch command ─────────────────────────────────────────────────────────────
export async function cmdBatch() {
  requireApiKey();
  banner();
  intro(pc.cyan("  Batch Apply"));

  const profile = await resolveActiveProfile();
  const args    = process.argv.slice(3);
  const dryRun  = args.includes("--dry-run");
  const resumeIdx  = args.indexOf("--resume");
  const resumePath = resumeIdx !== -1 ? args[resumeIdx + 1] : null;

  let batchFile = args.find(a => !a.startsWith("--") && !a.startsWith("http"));
  if (!batchFile) {
    batchFile = await text({
      message: "Path to jobs file (.txt, one URL per line):",
      placeholder: "./jobs.txt",
      validate: v => fs.existsSync(v.trim()) ? undefined : "File not found"
    });
    if (!batchFile) { cancel("Cancelled."); return; }
  }

  const lines = fs.readFileSync(batchFile.trim(), "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("http") && !l.startsWith("#"));

  if (!lines.length) {
    console.log(fmt.err("No valid URLs found in file. Lines starting with # are treated as comments."));
    return;
  }

  console.log(fmt.info(`Found ${lines.length} job(s) to process.`));

  const stats = { applied: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < lines.length; i++) {
    const url = lines[i];

    // Check daily limit before each job
    try { checkDailyLimit(); } catch (err) {
      console.log(fmt.err(`Daily limit (${DAILY_LIMIT}) reached — stopping batch.`));
      break;
    }

    console.log(`\n${pc.bold(pc.cyan(`[${i + 1}/${lines.length}]`))} ${pc.dim(url)}`);

    const status = await applySingleJob(url, profile, { dryRun, resumePath });

    stats[status === "applied" ? "applied" : status === "skipped" ? "skipped" : "errors"]++;

    if (i < lines.length - 1) {
      const next = await confirm({ message: "Continue to next job?" });
      if (!next) { console.log(fmt.warn("Batch stopped early.")); break; }
    }
  }

  outro(
    pc.bold("Batch complete:") + "\n" +
    `  ${pc.green("Applied:")}  ${stats.applied}\n` +
    `  ${pc.yellow("Skipped:")}  ${stats.skipped}\n` +
    `  ${pc.red("Errors:")}   ${stats.errors}`
  );
}
