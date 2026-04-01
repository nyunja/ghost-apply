import yaml from "js-yaml";
import { callAI } from "../../lib/llm/client.js";

const SYSTEM_PROMPT = `
You are a resume parser.

Your task is to extract structured information from a raw resume string and return it in VALID YAML format.

IMPORTANT RULES:
- Output ONLY valid YAML. No explanations, no markdown, no extra text.
- Do NOT invent or assume missing data.
- If a field is missing, use empty string "" or empty array [].
- Preserve original wording for descriptions and highlights.
- **Normalize dates** strictly into 'YYYY-MM' format if possible (e.g., "Jan 2022" -> "2022-01"). Use "Present" for current roles.
- **Standardize URLs**: Always prefix 'website', 'linkedin', and 'github' with 'https://' if missing. 
- **Normalize Personal Info**: Trim whitespace and lowercase emails.
- **Parse location into city + country**: If location contains a comma (e.g. "Kisumu, Kenya"), set city to the part before the comma and country to the part after. If no comma, make a best guess based on context.
- **Semantic Deduplication**: Do NOT extract multiple variations of the same skill (e.g., if 'React' and 'ReactJS' are both present, keep ONLY 'React'). Prefer the most concise canonical name.
- Remove duplicate skills within the same section.
- Extract technologies mentioned in experience/projects into "technologies" arrays.
- Keep bullet points as arrays of strings.
- Be consistent in formatting.

YAML SCHEMA TO FOLLOW EXACTLY:

personalInfo:
  name: ""
  title: ""
  email: ""
  phone: ""
  location: ""   # full location string as written on the resume
  city: ""       # city portion only (e.g. "Kisumu")
  country: ""    # country portion only (e.g. "Kenya")
  website: ""
  linkedin: ""
  github: ""
  otherLinks: []

summary:
  section: ""
  text: ""

skills:
  categories:
    - name: ""
      items: []

experience:
  section: ""
  roles:
    - title: ""
      company: ""
      location: ""
      period:
        start: ""
        end: ""
      highlights: []
      technologies: []

projects:
  section: ""
  items:
    - name: ""
      description: ""
      url: ""
      period: ""
      technologies: []
      highlights: []

education:
  section: ""
  items:
    - type: ""
      title: ""
      institution: ""
      location: ""
      period:
        start: ""
        end: ""
      year: ""
      details: []

certifications:
  section: ""
  items:
    - name: ""
      issuer: ""
      year: ""
      credentialId: ""
      url: ""

softSkills:
  section: ""
  items: []

languages:
  section: ""
  items:
    - name: ""
      proficiency: ""

awards:
  section: ""
  items:
    - title: ""
      issuer: ""
      year: ""
      description: ""

publications:
  section: ""
  items:
    - title: ""
      publisher: ""
      year: ""
      url: ""

volunteer:
  section: ""
  items:
    - role: ""
      organization: ""
      period: ""
      highlights: []

metadata:
  parsedAt: ""
  source: "raw_text"
  parserVersion: "v1"
`;

/**
 * Extracts structured data from a resume section/text using LLM.
 * Returns a JS object after parsing the YAML output.
 */
export async function extractEntities(text) {
  if (!text) return null;

  try {
    const rawYaml = await callAI(SYSTEM_PROMPT, `RAW RESUME TEXT:\n${text}`, 8000);
    
    // Clean potential markdown code blocks
    let cleaned = rawYaml.replace(/```yaml\n?|```/g, "").trim();
    
    // Repair potential truncation
    const repaired = repairYaml(cleaned);
    
    // Parse YAML to JS object
    const data = yaml.load(repaired);
    return data;
  } catch (err) {
    console.error("Extraction failed:", err.message);
    throw new Error(`Failed to extract data: ${err.message}`);
  }
}

/**
 * Extracts a single job role from a snippet of text.
 */
export async function extractRole(text) {
  if (!text) return null;

  const system = `You are a resume parser. Extract the following job role into VALID YAML.
Output ONLY YAML.

SCHEMA:
title: ""
company: ""
location: ""
period:
  start: ""
  end: ""
highlights: []
technologies: []`;

  try {
    const raw = await callAI(system, `TEXT:\n${text}`, 2000);
    const cleaned = raw.replace(/```yaml\n?|```/g, "").trim();
    const repaired = repairYaml(cleaned);
    return yaml.load(repaired);
  } catch (err) {
    console.warn("Role extraction failed:", err.message);
    return null;
  }
}

/**
 * Extracts a single project from a snippet of text.
 */
export async function extractProject(text) {
  if (!text) return null;

  const system = `You are a resume parser. Extract the following project into VALID YAML.
Output ONLY YAML.

SCHEMA:
name: ""
description: ""
url: ""
period: ""
technologies: []
highlights: []`;

  try {
    const raw = await callAI(system, `TEXT:\n${text}`, 2000);
    const cleaned = raw.replace(/```yaml\n?|```/g, "").trim();
    const repaired = repairYaml(cleaned);
    return yaml.load(repaired);
  } catch (err) {
    console.warn("Project extraction failed:", err.message);
    return null;
  }
}

/**
 * Simple heuristic-based YAML repair for truncated output.
 * Closes open quotes and arrays.
 */
function repairYaml(text) {
  if (!text) return "";
  let repaired = text;

  // 1. Check for open double quotes on the last line
  const lines = repaired.split("\n");
  const lastLine = lines[lines.length - 1];
  const quoteCount = (lastLine.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }

  // 2. Check for open arrays [
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closedBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closedBrackets) {
    repaired += "\n" + "  ".repeat(openBrackets - closedBrackets - 1) + "]";
  }

  return repaired;
}

/**
 * Specifically extracts personal info from the whole text using regex + heuristics
 * as a secondary layer.
 */
export function extractPersonalInfoHeuristics(text) {
  const info = {
    email: text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "",
    phone: text.match(/(\+?\d{1,3})?[\s-]?\d{9,}/)?.[0] || "",
    linkedin: text.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+\/?/i)?.[0] || "",
    github: text.match(/github\.com\/[a-zA-Z0-9-]+\/?/i)?.[0] || "",
  };
  return info;
}
