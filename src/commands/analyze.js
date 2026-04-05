import fs from "fs";
import os from "os";
import path from "path";
import pc from "picocolors";
import { intro, outro, text, confirm, select, spinner, note, cancel } from "@clack/prompts";

import { analyzeJD } from "../services/ai/jobAnalysis.js";
import { tailorCV } from "../services/ai/resumeTailoring.js";
import { generateCoverLetter } from "../services/ai/coverLetter.js";
import { resolveActiveProfile, requireApiKey, providerLabel, readJDFromFile, buildFilename } from "../utils/cliHelpers.js";
import { scrapeJD } from "../lib/browser/scraper.js";
import { safeExtractJD } from "../utils/jdValidator-agnostic.js";
import { isBlacklisted, alreadyApplied, recordApplication, addBlacklist, checkDailyLimit } from "../services/tracker.js";
import { banner, fmt, printAnalysis, printCV } from "../utils/display.js";
import { cmdGeneratePdf, cmdGenerateCoverLetterPdf } from "./profile.js";

export async function cmdAnalyze() {
  requireApiKey();
  try { checkDailyLimit(); } catch (err) {
    banner();
    console.log(fmt.err(err.message));
    process.exit(1);
  }
  banner();
  intro(pc.cyan("  Analyze + Tailor a Job Description"));

  const ACTIVE_PROFILE = await resolveActiveProfile();

  const cliUrl = process.argv.slice(3).find(a => a.startsWith("http"));

  const inputMethod = cliUrl ? "url" : await select({
    message: "How do you want to provide the JD?",
    options: [
      { value: "url",   label: "Load from URL  (scrapes the job posting)" },
      { value: "paste", label: "Paste text directly" },
      { value: "file",  label: "Load from a .txt file" },
    ]
  });
  if (!inputMethod) { cancel("Cancelled."); return; }

  let jdText = "";

  if (inputMethod === "url") {
    const jobUrl = cliUrl ?? await text({
      message: "Job posting URL:",
      placeholder: "https://jobs.lever.co/company/job-id",
      validate: v => v.startsWith("http") ? undefined : "Must be a full URL starting with http"
    });
    if (!jobUrl) { cancel("Cancelled."); return; }
    const s2 = spinner();
    s2.start("Scraping job description (stealth browser)...");
    try {
      const result = await safeExtractJD(scrapeJD, jobUrl, { debug: true });
      if (!result.success) {
        s2.stop(fmt.err(`Scrape failed: ${result.error}`));
        process.exit(1);
      }
      jdText = result.data;
      s2.stop(fmt.ok(`Scraped ${jdText.length} characters from ${new URL(jobUrl).hostname}`));
    } catch (err) {
      s2.stop(fmt.err("Scrape failed: " + err.message));
      process.exit(1);
    }
  } else if (inputMethod === "paste") {
    const raw = await text({
      message: "Paste the job description (press Enter twice when done):",
      placeholder: "Senior Backend Engineer at Acme...",
      validate: v => v.trim().length < 50 ? "JD seems too short — paste the full description." : undefined
    });
    if (!raw) { cancel("No input provided."); return; }
    jdText = raw;
  } else {
    const filePath = await text({
      message: "Path to .txt file:",
      placeholder: "./jd.txt"
    });
    if (!filePath) { cancel("Cancelled."); return; }
    jdText = readJDFromFile(filePath);
    if (!jdText) {
      console.log(fmt.err(`Could not read file: ${filePath}`));
      process.exit(1);
    }
  }

  const s = spinner();
  s.start(`Analyzing Job Description ${providerLabel()}...`);
  let analysis;
  try {
    analysis = await analyzeJD(jdText, ACTIVE_PROFILE);
    s.stop(fmt.ok(`Analysis complete — Match: ${analysis.matchScore}%`));
  } catch (err) {
    s.stop(fmt.err("Analysis failed: " + err.message));
    process.exit(1);
  }

  printAnalysis(analysis);

  if (analysis.company && isBlacklisted(analysis.company)) {
    console.log(fmt.warn(`${analysis.company} is on your blacklist.`));
    const proceed = await confirm({ message: "Continue anyway?" });
    if (!proceed) { outro("Skipped."); return; }
  }

  if (alreadyApplied(analysis.jobTitle, analysis.company)) {
    console.log(fmt.warn("You may have already applied to this role."));
    const proceed = await confirm({ message: "Continue anyway?" });
    if (!proceed) { outro("Skipped."); return; }
  }

  if (analysis.matchScore < 40) {
    console.log(fmt.warn(`Low match score (${analysis.matchScore}%). This role may not be a strong fit.`));
    const proceed = await confirm({ message: "Continue tailoring CV?" });
    if (!proceed) { outro("Understood. Skipping."); return; }
  }

  const tailorConfirm = await confirm({
    message: `Generate tailored CV for "${analysis.jobTitle}"?`
  });
  if (!tailorConfirm) { outro("Stopped after analysis."); return; }

  s.start(`Generating tailored CV bullets ${providerLabel()}...`);
  let cv;
  try {
    cv = await tailorCV(analysis, ACTIVE_PROFILE);
    s.stop(fmt.ok("CV tailored successfully."));
  } catch (err) {
    s.stop(fmt.err("Tailoring failed: " + err.message));
    process.exit(1);
  }

  let coverLetter = null;
  const scl = spinner();
  scl.start(`Generating cover letter ${providerLabel()}...`);
  try {
    coverLetter = await generateCoverLetter(analysis, ACTIVE_PROFILE, cv);
    scl.stop(fmt.ok("Cover letter generated."));
  } catch (err) {
    scl.stop(fmt.warn("Cover letter failed (skipping): " + err.message.split("\n")[0]));
  }

  printCV(cv);

  if (coverLetter) {
    note(pc.cyan(coverLetter), "📄 Cover Letter");
  }

  note(
    pc.yellow("Review the bullet rewrites above.\n") +
    pc.dim("Only mark as applied if you can genuinely\nspeak to all claims in an interview."),
    "⚠  Human Guard"
  );

  const action = await select({
    message: "What would you like to do?",
    options: [
      { value: "save",      label: "Save tailored CV to file" },
      { value: "applied",   label: "Mark as applied (log it)" },
      { value: "blacklist", label: "Blacklist this company" },
      { value: "nothing",   label: "Exit without saving" },
    ]
  });

  if (action === "save" || action === "applied") {
    const outDir  = path.join(os.homedir(), ".jobtailor", "outputs");
    fs.mkdirSync(outDir, { recursive: true });
    const ts       = Date.now();
    const { dirBase, pdfBase } = buildFilename(ACTIVE_PROFILE, analysis, null, ts);
    const outPath  = path.join(outDir, `${dirBase}_cv.txt`);
    const jsonPath = path.join(outDir, `${pdfBase}_CV.json`);

    const content = [
      `JOB: ${analysis.jobTitle}${analysis.company ? " @ " + analysis.company : ""}`,
      `DATE: ${new Date().toLocaleDateString()}`,
      `MATCH: ${analysis.matchScore}%`,
      "",
      "── HEADLINE ──",
      cv.headline,
      "",
      "── SUMMARY ──",
      cv.summary,
      "",
      "── TAILORED BULLETS ──",
      ...(cv.injectedBullets?.map(b => `• ${b.tailored}`) ?? []),
      "",
      "── COVER LINE ──",
      cv.coverLineSuggestion ?? "–",
      "",
      "── KEYWORDS INJECTED ──",
      cv.keywordsInjected?.join(", ") ?? "–"
    ].join("\n");

    fs.writeFileSync(outPath, content);
    fs.writeFileSync(jsonPath, JSON.stringify(cv, null, 2));
    console.log(fmt.ok(`Saved → ${outPath}`));

    if (coverLetter) {
      const clJsonPath = path.join(outDir, `${pdfBase}_Cover-Letter.json`);
      fs.writeFileSync(clJsonPath, JSON.stringify(coverLetter, null, 2));
      console.log(fmt.ok(`Cover letter → ${clJsonPath}`));
    }

    const makePdf = await confirm({ message: "Generate PDF resume + cover letter?" });
    if (makePdf) {
      await cmdGeneratePdf(jsonPath, path.join(outDir, `${pdfBase}_CV.pdf`));
      if (coverLetter) {
        const clJsonPath = path.join(outDir, `${pdfBase}_Cover-Letter.json`);
        await cmdGenerateCoverLetterPdf(clJsonPath, path.join(outDir, `${pdfBase}_Cover-Letter.pdf`));
      }
    }
  }

  if (action === "applied" || action === "save") {
    recordApplication({
      jobTitle:   analysis.jobTitle,
      company:    analysis.company,
      matchScore: analysis.matchScore,
      status:     action === "applied" ? "applied" : "saved",
      keywords:   analysis.topKeywords
    });
    if (action === "applied") {
      console.log(fmt.ok("Logged to application tracker."));
    }
  }

  if (action === "blacklist" && analysis.company) {
    addBlacklist(analysis.company);
    console.log(fmt.ok(`"${analysis.company}" added to blacklist.`));
  }

  outro(pc.cyan("Good luck with the application! 🚀"));
}
