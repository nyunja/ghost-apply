import { callAI } from "../../lib/llm/client.js";

const CATEGORIES = [
  "Languages",
  "Frontend",
  "Backend",
  "Databases",
  "DevOps & Cloud",
  "Testing & QA",
  "Tools & Methodologies",
  "Soft Skills"
];

/**
 * Enriches the parsed resume data with inferred skills 
 * and logical categorization.
 */
export async function enrich(data) {
  if (!data) return null;

  // 1. Consolidate all skills found in categories, experience, and projects
  let allSkills = new Set();
  
  const addSkill = (s) => {
    if (typeof s !== "string") return;
    const clean = s.trim();
    if (clean) allSkills.add(clean);
  };

  if (data.skills?.categories) {
    data.skills.categories.forEach(cat => cat.items.forEach(addSkill));
  }
  
  if (data.experience?.roles) {
    data.experience.roles.forEach(role => role.technologies?.forEach(addSkill));
  }

  if (data.projects?.items) {
    data.projects.items.forEach(proj => proj.technologies?.forEach(addSkill));
  }

  // 2. If skills are lacking, infer from experience descriptions
  if (allSkills.size < 5 && data.experience?.roles?.length > 0) {
    const textToAnalyze = data.experience.roles.map(r => r.highlights.join(" ")).join("\n");
    const inferred = await inferSkillsWithAI(textToAnalyze);
    if (inferred) {
      inferred.forEach(s => allSkills.add(s));
    }
  }

  // 3. Categorize consolidated skills
  const categorized = await categorizeSkillsWithAI(Array.from(allSkills));
  if (categorized) {
    data.skills.categories = Object.entries(categorized).map(([name, items]) => ({
      name,
      items
    }));
  }

  // 4. Update metadata
  data.metadata.parsedAt = new Date().toISOString();
  data.metadata.parserVersion = "v2.0-hybrid";

  return data;
}

async function inferSkillsWithAI(text) {
  const system = `Extract all technical skills, frameworks, and tools mentioned in the following experience descriptions. 
Return ONLY a JSON array of strings.`;
  
  try {
    const raw = await callAI(system, `TEXT:\n${text}`, 1000);
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function categorizeSkillsWithAI(skills) {
  const system = `Categorize the following skills into logical groups: 
[${CATEGORIES.join(", ")}]

IMPORTANT RULES:
1. **AGGRESSIVE Semantic Deduplication**: Merge all variations of a technology into its most common canonical name (e.g., 'React (TS)', 'ReactJS', and 'React' MUST be merged into 'React').
2. **Remove Redundant Parent-Child listings**: If a suite like 'AWS' is listed alongside its sub-services ('AWS SQS', 'AWS ECS'), combine them into 'AWS' or keep only the specific sub-services if they add value, but NEVER list them separately in a repetitive way.
3. **Canonicalize Names**: Use industry-standard capitalization (e.g., 'PostgreSQL' instead of 'Postgres', 'Node.js' instead of 'nodejs').
4. **Strict Uniqueness**: A skill must ONLY appear in the MOST relevant category.
5. **JSON ONLY**: Return ONLY valid JSON where keys are category names and values are arrays of strings.`;

  try {
    const raw = await callAI(system, `SKILLS:\n${skills.join(", ")}`, 2000);
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
