import { preprocess } from "./preprocessor.js";
import { detectSections, splitRoles, splitProjects } from "./sectionDetector.js";
import { 
  extractEntities, 
  extractRole, 
  extractProject, 
  extractPersonalInfoHeuristics 
} from "./extractor.js";
import { mergeFragments } from "./merger.js";
import { enrich } from "./enricher.js";

/**
 * Main entrance to the resume parsing pipeline.
 * Takes raw text and returns a structured, normalized JS object.
 */
export async function runPipeline(rawText, onProgress) {
  if (!rawText) throw new Error("No resume text provided.");

  if (onProgress) onProgress("Cleaning text...");
  const cleanedText = preprocess(rawText);

  // 1. Determine if we need chunking based on size
  const SHOULD_CHUNK = cleanedText.length > 4000;
  let finalData;

  if (SHOULD_CHUNK) {
    if (onProgress) onProgress("Detecting resume sections...");
    const sections = await detectSections(cleanedText);

    if (onProgress) onProgress("Splitting experience and projects...");
    const roleBlocks = await splitRoles(sections.experience ?? "");
    const projectBlocks = await splitProjects(sections.projects ?? "");

    // 2. Perform Parallel Targeted Extractions
    const tasks = [];

    // General sections (everything except experience/projects)
    tasks.push((async () => {
      const generalText = Object.entries(sections)
        .filter(([k]) => k !== "experience" && k !== "projects")
        .map(([_, v]) => v)
        .join("\n\n");
      if (onProgress) onProgress("Extracting general sections...");
      return await extractEntities(generalText);
    })());

    // Experience Roles (limit parallelism to 3 to avoid rate limits)
    roleBlocks.forEach((block, idx) => {
      tasks.push((async () => {
        if (onProgress) onProgress(`Extracting role ${idx + 1}/${roleBlocks.length}...`);
        const role = await extractRole(block);
        return { role };
      })());
    });

    // Projects
    projectBlocks.forEach((block, idx) => {
      tasks.push((async () => {
        if (onProgress) onProgress(`Extracting project ${idx + 1}/${projectBlocks.length}...`);
        const project = await extractProject(block);
        return { project };
      })());
    });

    const results = await Promise.all(tasks);
    finalData = mergeFragments({}, results);
  } else {
    // Standard extraction for smaller resumes
    if (onProgress) onProgress("Extracting entities [AI]...");
    finalData = await extractEntities(cleanedText);
  }

  if (!finalData) {
    throw new Error("Extraction failed to return data.");
  }

  // 3. Fill in heuristic gaps
  const heuristics = extractPersonalInfoHeuristics(cleanedText);
  if (finalData.personalInfo) {
    finalData.personalInfo.email    = finalData.personalInfo.email    || heuristics.email;
    finalData.personalInfo.phone    = finalData.personalInfo.phone    || heuristics.phone;
    finalData.personalInfo.linkedin = finalData.personalInfo.linkedin || heuristics.linkedin;
    finalData.personalInfo.github   = finalData.personalInfo.github   || heuristics.github;

    // Derive city/country from location string if AI didn't split them
    const loc = finalData.personalInfo.location || "";
    if (loc && !finalData.personalInfo.city && !finalData.personalInfo.country) {
      const parts = loc.split(",").map(s => s.trim()).filter(Boolean);
      finalData.personalInfo.city    = parts.length > 1 ? parts[0] : "";
      finalData.personalInfo.country = parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
    }
  }

  // 4. Enrichment
  if (onProgress) onProgress("Enriching profile [AI]...");
  let enrichedData = await enrich(finalData);

  // 5. Standardization is now handled natively via AI Prompts
  if (onProgress) onProgress("Finalizing profile...");
  
  return enrichedData;
}
