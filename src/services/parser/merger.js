/**
 * Merges multiple resume fragments (role, projects, sections) 
 * into a single unified profile object.
 * Deduplicates roles by (title + company) and projects by name.
 */
export function mergeFragments(base, fragments) {
  const merged = { ...base };

  if (!merged.personalInfo) merged.personalInfo = {};
  if (!merged.skills) merged.skills = { categories: [] };
  if (!merged.experience) merged.experience = { roles: [] };
  if (!merged.projects) merged.projects = { items: [] };
  if (!merged.education) merged.education = { items: [] };
  if (!merged.metadata) merged.metadata = {};

  fragments.forEach(frag => {
    if (!frag) return;

    // 1. Personal Info (Merge non-empty fields, first-write wins)
    if (frag.personalInfo) {
      Object.entries(frag.personalInfo).forEach(([key, val]) => {
        if (val && !merged.personalInfo[key]) {
          merged.personalInfo[key] = val;
        }
      });
    }

    // 2. Summary (first non-empty wins)
    if (frag.summary?.text && !merged.summary?.text) {
      merged.summary = frag.summary;
    }

    // 3. Skills — merge by category name, deduplicate items within each category
    if (frag.skills?.categories) {
      frag.skills.categories.forEach(newCat => {
        const existingCat = merged.skills.categories.find(c => c.name === newCat.name);
        if (existingCat) {
          existingCat.items = Array.from(new Set([...existingCat.items, ...newCat.items]));
        } else {
          merged.skills.categories.push({ ...newCat, items: [...newCat.items] });
        }
      });
    }

    // 4. Experience Roles — append, but deduplicate by fuzzy (title + company) match
    if (frag.role && isValidRole(frag.role)) {
      mergeRoleIntoList(merged.experience.roles, frag.role);
    }
    if (frag.experience?.roles) {
      frag.experience.roles.forEach(role => {
        if (isValidRole(role)) mergeRoleIntoList(merged.experience.roles, role);
      });
    }

    // 5. Projects — append, deduplicate by name
    const projKey = (p) => (p.name ?? "").toLowerCase().trim();

    if (frag.project && frag.project.name) {
      const key = projKey(frag.project);
      if (!merged.projects.items.some(p => projKey(p) === key)) {
        merged.projects.items.push(frag.project);
      }
    }
    if (frag.projects?.items) {
      frag.projects.items.forEach(proj => {
        if (!proj?.name) return;
        const key = projKey(proj);
        if (!merged.projects.items.some(p => projKey(p) === key)) {
          merged.projects.items.push(proj);
        }
      });
    }

    // 6. Education — deduplicate by (title + institution)
    if (frag.education?.items) {
      frag.education.items.forEach(item => {
        const eduKey = `${(item.title ?? "").toLowerCase()}|${(item.institution ?? "").toLowerCase()}`;
        const exists = merged.education.items.some(e =>
          `${(e.title ?? "").toLowerCase()}|${(e.institution ?? "").toLowerCase()}` === eduKey
        );
        if (!exists) merged.education.items.push(item);
      });
    }

    // 7. Other sections — deduplicate items arrays by string value
    ["certifications", "softSkills", "languages", "awards", "publications", "volunteer"].forEach(key => {
      if (frag[key]?.items) {
        if (!merged[key]) merged[key] = { items: [] };
        frag[key].items.forEach(item => {
          // Simple dedup: compare JSON strings
          const itemStr = JSON.stringify(item);
          if (!merged[key].items.some(i => JSON.stringify(i) === itemStr)) {
            merged[key].items.push(item);
          }
        });
      }
    });

    // 8. Metadata
    if (frag.metadata) {
      Object.assign(merged.metadata, frag.metadata);
    }
  });

  return merged;
}

/**
 * Checks if a role object has at least a title or company (not an empty stub).
 */
function isValidRole(role) {
  return !!(role && (role.title || role.company));
}

/**
 * Fuzzy role deduplication helper.
 * If the role already exists, merges highlights. Otherwise, appends it.
 */
function mergeRoleIntoList(list, newRole) {
  const existing = list.find(r => isDuplicateRole(r, newRole));
  if (existing) {
    // Merge highlights
    const existingHighlights = existing.highlights ?? [];
    const newHighlights = newRole.highlights ?? [];
    existing.highlights = Array.from(new Set([...existingHighlights, ...newHighlights]));
    
    // Merge technologies
    const existingTech = existing.technologies ?? [];
    const newTech = newRole.technologies ?? [];
    existing.technologies = Array.from(new Set([...existingTech, ...newTech]));
  } else {
    list.push(newRole);
  }
}

/**
 * Determines if two roles are likely the same job entry.
 */
function isDuplicateRole(r1, r2) {
  const t1 = (r1.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const t2 = (r2.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const c1 = (r1.company ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const c2 = (r2.company ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // If titles are very similar and one company is a substring of the other
  const titlesMatch = t1 === t2 || t1.includes(t2) || t2.includes(t1);
  
  if (titlesMatch) {
    if (!c1 || !c2) {
      // If one is empty, check if the other title contains the keywords
      return (c1 === c2) || (c1 ? t2.includes(c1) : t1.includes(c2));
    }
    return c1.includes(c2) || c2.includes(c1);
  }

  return false;
}
