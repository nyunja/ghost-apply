import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import pc from "picocolors";
import { text, confirm, select, spinner, cancel, outro } from "@clack/prompts";

import { requireApiKey, providerLabel } from "../utils/cliHelpers.js";
import { extractProfileFromText } from "../services/ai/profileExtraction.js";
import {
  listProfiles, loadProfile, saveProfile, deleteProfile,
  getActiveProfileId, setActiveProfileId, loadActiveProfile,
  parseResumeFile
} from "../services/profiles.js";
import { banner, fmt } from "../utils/display.js";

// Needs __dirname manually because this is an esm module
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function cmdProfile() {
  banner();
  const sub = process.argv[3]; // add | list | switch | delete

  if (!sub || sub === "list") {
    const profiles = listProfiles();
    const activeId = getActiveProfileId();
    if (!profiles.length) {
      console.log(fmt.warn("No profiles yet.  Run: node index.js profile add <resume.pdf>"));
      return;
    }
    console.log(pc.bold("\n  Saved profiles:\n"));
    profiles.forEach(p => {
      const active = p.id === activeId ? pc.green(" ✔ active") : "";
      console.log(`  ${pc.cyan(p.label)}  ${pc.dim("(" + p.category + ")")}${active}`);
      console.log(`    ${pc.dim("id: " + p.id)}`);
    });
    console.log();
    return;
  }

  if (sub === "add") {
    requireApiKey();
    let filePath = process.argv[4];
    if (!filePath) {
      filePath = await text({
        message: "Path to resume file (.pdf, .docx, .doc, or .txt):",
        placeholder: "./resume.pdf",
        validate: v => fs.existsSync(v.trim()) ? undefined : "File not found",
      });
      if (!filePath) { cancel("Cancelled."); return; }
    }
    filePath = filePath.trim();
    if (!fs.existsSync(filePath)) {
      console.log(fmt.err(`File not found: ${filePath}`));
      process.exit(1);
    }

    const s1 = spinner();
    s1.start("Reading resume file...");
    let resumeText;
    try {
      resumeText = await parseResumeFile(filePath);
      s1.stop(fmt.ok(`Read ${resumeText.length} characters`));
    } catch (err) {
      s1.stop(fmt.err("Could not read file: " + err.message));
      process.exit(1);
    }

    const s2 = spinner();
    s2.start(`Extracting profile...`);
    let extracted;
    try {
      extracted = await extractProfileFromText(resumeText, (msg) => {
        s2.message(`${msg} ${providerLabel()}`);
      });
      s2.stop(fmt.ok(`Extracted profile: ${extracted.personalInfo?.name ?? extracted._label ?? extracted.name ?? "(unknown)"}`));
    } catch (err) {
      s2.stop(fmt.err("AI extraction failed: " + err.message.split("\n")[0]));
      process.exit(1);
    }

    // Support both new YAML schema (personalInfo.name) and old flat schema (name)
    const displayName  = extracted.personalInfo?.name  ?? extracted.name  ?? "";
    const displayTitle = extracted.personalInfo?.title ?? extracted.title ?? "";
    const label    = displayName || displayTitle || extracted._label || "Unnamed Profile";
    const category = extracted._category ?? "Other";

    // Collect skills from new categories format, or fall back to old stack array
    const skillsList = extracted.skills?.categories
      ? extracted.skills.categories.flatMap((c) => c.items).slice(0, 5)
      : (extracted.stack ?? []).slice(0, 5);
    const allSkillsCount = extracted.skills?.categories
      ? extracted.skills.categories.flatMap((c) => c.items).length
      : (extracted.stack?.length ?? 0);

    // Collect job titles from new roles format, or fall back to old experience array
    const jobTitles = extracted.experience?.roles
      ? extracted.experience.roles.map((r) => `${r.title ?? ""} @ ${r.company ?? ""}`)
      : (extracted.experience ?? []).map((e) => e.role ?? e.title ?? "");

    console.log(pc.bold(`\n  Name:     `) + displayName);
    console.log(pc.bold(`  Title:    `) + displayTitle);
    console.log(pc.bold(`  Label:    `) + label + pc.dim(`  (${category})`));
    console.log(pc.bold(`  Skills:   `) + skillsList.join(", ") + (allSkillsCount > 5 ? "..." : ""));
    console.log(pc.bold(`  Jobs:     `) + jobTitles.join(" | "));
    console.log();

    const confirmed = await confirm({ message: `Save as "${label}"?` });
    if (!confirmed) { outro("Not saved."); return; }

    const { id, filePath: savedPath } = saveProfile(label, category, extracted);
    console.log(fmt.ok(`Profile saved → ${savedPath}`));

    const makeActive = await confirm({ message: "Set as active profile?" });
    if (makeActive) {
      setActiveProfileId(id);
      console.log(fmt.ok("Active profile updated."));
    }
    outro("Done.");
    return;
  }

  if (sub === "switch") {
    const profiles = listProfiles();
    if (!profiles.length) {
      console.log(fmt.warn("No profiles yet.  Run: node index.js profile add <resume.pdf>"));
      return;
    }
    const chosen = await select({
      message: "Select active profile:",
      options: profiles.map(p => ({
        value: p.id,
        label: `${p.label}  ${pc.dim("(" + p.category + ")")}`,
        hint:  p.name,
      })),
    });
    if (!chosen) { cancel("Cancelled."); return; }
    setActiveProfileId(chosen);
    const picked = profiles.find(p => p.id === chosen);
    console.log(fmt.ok(`Active profile → ${picked?.label}`));
    return;
  }

  if (sub === "delete") {
    const profiles = listProfiles();
    if (!profiles.length) { console.log(fmt.warn("No profiles to delete.")); return; }
    const chosen = await select({
      message: "Which profile do you want to delete?",
      options: profiles.map(p => ({
        value: p.id,
        label: `${p.label}  ${pc.dim("(" + p.category + ")")}`,
        hint:  p.name,
      })),
    });
    if (!chosen) { cancel("Cancelled."); return; }
    const confirmed = await confirm({ message: "Delete this profile? This cannot be undone." });
    if (!confirmed) { outro("Cancelled."); return; }
    deleteProfile(chosen);
    if (getActiveProfileId() === chosen) setActiveProfileId(null);
    console.log(fmt.ok("Profile deleted."));
    return;
  }

  console.log(fmt.err(`Unknown subcommand: ${sub}`));
  console.log(pc.dim("  Usage: node index.js profile [add|list|switch|delete]"));
}

export function cmdExportProfile() {
  const profileJsonPath = path.join(path.dirname(__dirname), "..", "profile.json");
  const activeProfile = loadActiveProfile();
  if (!activeProfile) { console.log(fmt.err("No profiles found. Run: node index.js profile add <resume.pdf>")); return; }
  fs.writeFileSync(profileJsonPath, JSON.stringify(activeProfile, null, 2));
  console.log(fmt.ok(`Profile exported → ${profileJsonPath}`));
}

export async function cmdGeneratePdf(cvJsonPath, outPdfPath) {
  const resolvedCv  = cvJsonPath ?? process.argv[3];
  const resolvedOut = outPdfPath ?? process.argv[4];

  if (!resolvedCv) {
    console.log(fmt.err("Usage: node index.js generate-pdf <tailored_cv.json> [output.pdf]"));
    process.exit(1);
  }

  // Write active profile to a temp file so Python can read it
  const activeProfile = loadActiveProfile();
  if (!activeProfile) { console.log(fmt.err("No profiles found. Run: node index.js profile add <resume.pdf>")); process.exit(1); }
  const tmpProfile = path.join(os.tmpdir(), `jobtailor-profile-${Date.now()}.json`);
  fs.writeFileSync(tmpProfile, JSON.stringify(activeProfile, null, 2));

  const s = spinner();
  s.start("Generating PDF resume...");
  try {
    const scriptPath = path.join(path.dirname(__dirname), "..", "pdf_resume.py");
    const outPath    = resolvedOut ?? resolvedCv.replace(".json", ".pdf");
    execSync(`python3 "${scriptPath}" resume "${tmpProfile}" "${resolvedCv}" "${outPath}"`, { stdio: "pipe" });
    s.stop(fmt.ok(`PDF ready → ${outPath}`));
    return outPath;
  } catch (err) {
    s.stop(fmt.err("PDF generation failed: " + (err.stderr?.toString() ?? err.message)));
  } finally {
    fs.unlinkSync(tmpProfile);
  }
}

export async function cmdGenerateCoverLetterPdf(clJsonPath, outPdfPath) {
  const resolvedCl  = clJsonPath ?? process.argv[3];
  const resolvedOut = outPdfPath ?? process.argv[4];

  if (!resolvedCl) {
    console.log(fmt.err("Usage: node index.js generate-cover-pdf <cover_letter.json> [output.pdf]"));
    process.exit(1);
  }

  const s = spinner();
  s.start("Generating cover letter PDF...");
  try {
    const scriptPath = path.join(path.dirname(__dirname), "..", "pdf_resume.py");
    const outPath    = resolvedOut ?? resolvedCl.replace(".json", ".pdf");
    execSync(`python3 "${scriptPath}" cover "${resolvedCl}" "${outPath}"`, { stdio: "pipe" });
    s.stop(fmt.ok(`Cover letter PDF ready → ${outPath}`));
    return outPath;
  } catch (err) {
    s.stop(fmt.err("Cover letter PDF generation failed: " + (err.stderr?.toString() ?? err.message)));
  }
}
