import { callAI } from "../../lib/llm/client.js";

// Comprehensive, section-heading patterns. Tested against many real resume formats.
// Scores each heading candidate by checking if the line is short, uppercase, or matches known terms.
const SECTION_RULES = [
  {
    name: "personalInfo",
    patterns: [/^(?:personal\s*(?:info|information|details|profile)|contact|identity)/i, /^name[\s:]/i],
  },
  {
    name: "summary",
    patterns: [
      /^(?:summary|professional\s*summary|career\s*summary|profile|about\s*me|objective|career\s*objective|professional\s*profile|overview)/i,
    ],
  },
  {
    name: "skills",
    patterns: [
      /^(?:skills|technical\s*skills|core\s*skills|key\s*skills|stack|technologies|expertise|tech\s*stack|competencies|core\s*competencies|tools)/i,
    ],
  },
  {
    name: "experience",
    patterns: [
      /^(?:experience|work\s*(?:history|experience)|professional\s*experience|employment|employment\s*(?:history|experience)|career\s*(?:history|experience)|relevant\s*experience)/i,
    ],
  },
  {
    name: "projects",
    patterns: [
      /^(?:projects|personal\s*projects|selected\s*projects|portfolio|notable\s*projects|key\s*projects|open\s*source)/i,
    ],
  },
  {
    name: "education",
    patterns: [
      /^(?:education|academic\s*background|academic\s*qualifications|studies|degrees?|qualifications|schooling)/i,
    ],
  },
  {
    name: "certifications",
    patterns: [/^(?:certifications?|licenses?|credentials?|professional\s*certifications?)/i],
  },
  {
    name: "softSkills",
    patterns: [/^(?:soft\s*skills|interpersonal|traits|personal\s*qualities)/i],
  },
  {
    name: "languages",
    patterns: [/^(?:languages?|spoken\s*languages?|translations?)/i],
  },
  {
    name: "awards",
    patterns: [/^(?:awards?|honors?|achievements?|accomplishments?|recognition)/i],
  },
  {
    name: "publications",
    patterns: [/^(?:publications?|research|articles?|papers?|books?|presentations?)/i],
  },
  {
    name: "volunteer",
    patterns: [/^(?:volunteer|volunteering|community\s*service|community\s*involvement)/i],
  },
  {
    name: "interests",
    patterns: [/^(?:interests?|hobbies|passions?|activities)/i],
  },
];

/**
 * Determines if a line is likely a section heading.
 * A section heading is typically short, possibly all-caps, and matches a known section term.
 * Max length of 60 chars prevents matching long content lines.
 */
function detectSectionName(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null;

  for (const rule of SECTION_RULES) {
    if (rule.patterns.some((p) => p.test(trimmed))) {
      return rule.name;
    }
  }
  return null;
}

/**
 * Detects resume sections from raw text.
 * 
 * Strategy:
 * 1. Rule-based scan (no AI cost, fast)
 * 2. If key sections are missing → Chunk-based AI boundary detection
 *    (send small 1500-char overlapping windows, ask AI what sections are in each)
 * 3. Merge the boundary map back into section text
 */
export async function detectSections(text) {
  const ruleBased = detectByRules(text);

  // If we found the critical sections, we're done
  if (hasEnoughSections(ruleBased)) {
    return ruleBased;
  }

  console.warn("  [warn] Rule-based section detection incomplete. Running chunk-based boundary scan...");
  const chunkBased = await detectByChunks(text);

  // Merge: prefer chunk-based for sections that rule-based missed
  return { ...chunkBased, ...Object.fromEntries(
    Object.entries(ruleBased).filter(([_, v]) => v && v.length > 20)
  )};
}

/**
 * Pure rule-based detector. Fast, zero AI cost.
 */
function detectByRules(text) {
  const lines = text.split("\n");
  const sections = {};
  let currentSection = "personalInfo";

  for (const line of lines) {
    const detected = detectSectionName(line);
    if (detected) {
      currentSection = detected;
    }
    if (!sections[currentSection]) sections[currentSection] = [];
    sections[currentSection].push(line);
  }

  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].join("\n").trim();
  }

  return sections;
}

/**
 * Checks if the detected sections are sufficient to proceed.
 */
function hasEnoughSections(sections) {
  return !!(sections.experience && sections.experience.length > 80);
}

/**
 * Chunk-based AI boundary detection.
 * Splits text into overlapping 1500-char chunks, asks the AI to identify
 * which section label each chunk belongs to, and maps the results back.
 */
async function detectByChunks(text) {
  const CHUNK_SIZE = 1500;
  const OVERLAP = 300; // Increased overlap for better context
  const sections = {};

  const chunks = [];
  for (let start = 0; start < text.length; start += CHUNK_SIZE - OVERLAP) {
    chunks.push({
      offset: start,
      text: text.slice(start, start + CHUNK_SIZE),
      overlapText: start > 0 ? text.slice(start, start + OVERLAP) : null,
    });
  }

  const labelPromises = chunks.map(async (chunk, idx) => {
    const system = `You are a resume section identifier. 
Given a chunk of resume text, identify the dominant section.
${chunk.overlapText ? `\nIMPORTANT: The first ${OVERLAP} characters are OVERLAP from the previous chunk. 
Find the logical STARTING POINT of the next NEW section or role that is NOT part of that overlap.` : ""}

Return ONLY a JSON object:
{
  "section": "experience",
  "startingText": "The first 5-7 words of the new section/role"
}

Valid sections: personalInfo, summary, skills, experience, projects, education, certifications, softSkills, languages, awards, volunteer`;

    try {
      const raw = await callAI(system, `CHUNK:\n${chunk.text}`, 150);
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      
      let processedText = chunk.text;
      if (parsed.startingText && idx > 0) {
        const startIdx = chunk.text.indexOf(parsed.startingText);
        if (startIdx !== -1) {
          processedText = chunk.text.slice(startIdx);
        }
      }

      return { section: parsed.section, text: processedText };
    } catch {
      return { section: null, text: chunk.text };
    }
  });

  const labeled = await Promise.all(labelPromises);

  // Group by section
  for (const { section, text: chunkText } of labeled) {
    if (!section || section === "unknown") continue;
    if (!sections[section]) sections[section] = [];
    sections[section].push(chunkText);
  }

  // Deduplicate and join
  for (const key of Object.keys(sections)) {
    const combined = sections[key].join("\n");
    const lines = combined.split("\n");
    const seen = new Set();
    sections[key] = lines.filter((l) => {
      const t = l.trim();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    }).join("\n").trim();
  }

  return sections;
}

/**
 * AI fallback — only asked to extract the "experience" section text.
 * Much smaller prompt → lower risk of truncation.
 */
async function detectExperienceWithAI(text) {
  const system = `You are a resume parser assistant. 
Extract ONLY the "Work Experience" section text from the resume below.
Return the exact raw text of that section ONLY, no JSON, no YAML, no explanation.`;

  try {
    const raw = await callAI(system, `RESUME:\n${text.slice(0, 5000)}`, 2000);
    return raw.trim() || null;
  } catch (err) {
    console.warn("  [warn] AI experience detection failed.", err.message);
    return null;
  }
}

/**
 * Splits an experience section into individual job role blocks
 * using deterministic structural cues (blank lines + date patterns).
 * Falls back to AI splitting only if structure detection yields <= 1 block.
 */
export async function splitRoles(experienceText) {
  if (!experienceText || experienceText.trim().length < 50) return [];

  const blocks = splitByStructure(experienceText);
  if (blocks.length > 1) return blocks;

  // AI fallback only if structural splitting found nothing
  return await splitWithAI("roles", experienceText);
}

/**
 * Splits a projects section into individual project blocks
 * using deterministic structural cues.
 */
export async function splitProjects(projectsText) {
  if (!projectsText || projectsText.trim().length < 50) return [];

  const blocks = splitByStructure(projectsText);
  if (blocks.length > 1) return blocks;

  return await splitWithAI("projects", projectsText);
}

/**
 * Splits a block of text into sub-blocks using structural cues:
 * - Double newlines followed by a title-cased or ALL-CAPS short line
 * - Lines containing a date pattern (e.g. "Jan 2020", "2019 - 2021", "Present")
 */
function splitByStructure(text) {
  // A "role/project boundary" is a line that:
  // 1. Is short (< 80 chars)
  // 2. Doesn't start with "-" or "•" (not a bullet)
  // 3. Contains a year or company-title indicator
  const DATE_PATTERN = /(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b\d{4}\b.*(?:\bpresent\b|–|-|–)|\bpresent\b)/i;
  const lines = text.split("\n");

  const blocks = [];
  let currentBlock = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // A new block starts when:
    // 1. The current line is non-empty and the previous was blank, AND
    // 2. The current line looks like a header (short, no bullet)
    const prevLine = i > 0 ? lines[i - 1].trim() : "non-empty"; // avoid boundary at start
    const isBullet = /^[-•*]/.test(trimmed);
    const isShort = trimmed.length > 0 && trimmed.length < 80;
    const hasDate = DATE_PATTERN.test(trimmed);
    const prevWasBlank = prevLine === "";
    const isBlockBoundary = isShort && !isBullet && hasDate && prevWasBlank && currentBlock.length > 0;

    if (isBlockBoundary) {
      blocks.push(currentBlock.join("\n").trim());
      currentBlock = [];
    }

    currentBlock.push(line);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n").trim());
  }

  return blocks.filter((b) => b.trim().length > 10);
}

/**
 * AI-based splitting as a last resort. Asks only for a list of separators, not full content.
 */
async function splitWithAI(type, text) {
  const label = type === "roles" ? "job roles" : "projects";
  const system = `Divide the following resume section into individual ${label}.
Return ONLY a JSON array of strings. Each string is the raw text for ONE ${label.slice(0, -1)}.
Do NOT summarize. Include all original text for each ${label.slice(0, -1)}.`;

  try {
    const raw = await callAI(system, `TEXT:\n${text}`, 2000);
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [text];
  } catch (err) {
    console.warn(`  [warn] AI ${type} splitting failed. Using full block.`, err.message);
    return [text];
  }
}
