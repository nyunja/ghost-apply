// ─────────────────────────────────────────────
//  browserUtils.js — Shared DOM Investigation Logic
//  Common browser-side functions to keep explorer.js 
//  and applyAutomation.js in sync.
// ─────────────────────────────────────────────


/**
 * Standard field list used to skip during generic question scans.
 */
export const SKIP_FIELDS = [
  "first", "last", "fullname", "full_name", "preferred", "email", "phone", "tel",
  "mobile", "city", "location", "address", "linkedin", "github",
  "portfolio", "website", "resume", "cover", "letter",
];

/**
 * Checks if a DOM element is a standard personal info field.
 */
export function isStandardField(el) {
  // Handle both DOM elements (browser) and plain objects (Node.js)
  const autocomplete = typeof el.getAttribute === "function" 
    ? el.getAttribute("autocomplete") 
    : el.autocomplete;
    
  const hay = [el.name, el.id, el.placeholder, autocomplete]
    .filter(Boolean).join(" ").toLowerCase();
  return SKIP_FIELDS.some(p => hay.includes(p));
}

/**
 * Finds all clickable elements on the page for AI analysis.
 * (Runs inside page.evaluate)
 */
export function findClickableCandidates() {
  const candidates = [];
  const elements = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]');
  elements.forEach((el, i) => {
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      candidates.push({
        index: i,
        html: el.outerHTML.slice(0, 400), // snippet for AI context
        text: el.innerText?.trim() || el.value || ""
      });
    }
  });
  return candidates;
}

/**
 * Scans all input fields to find "Additional Questions" (non-standard).
 */
export function scanFields() {
  const getLabel = el => {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText.trim();
    const fs = el.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); if (lg) return lg.innerText.trim(); }
    const parent = el.closest('[class*="field"],[class*="question"],[class*="form-group"],[class*="input-wrap"],[class*="styles--"]');
    if (parent) {
      for (const c of parent.querySelectorAll("label,p,span,[class*='label']")) {
        const t = c.innerText?.trim();
        if (t && !c.contains(el)) return t;
      }
    }
    return el.placeholder || el.name || el.id || "(no label)";
  };

  const radioGroups = {};
  const seen = new Set();
  const fields = [];

  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=submit]), select, textarea")) {
    if (el.disabled || el.closest("[disabled]") || el.readOnly) continue;
    if (window.getComputedStyle(el).display === 'none') continue;

    const type = (el.type || el.tagName).toLowerCase();
    const name = el.name || el.id || "";
    const label = getLabel(el);

    if (type === "radio") {
      if (!radioGroups[name]) {
        radioGroups[name] = { type: "radio", label, name, options: [] };
        fields.push(radioGroups[name]);
      }
      radioGroups[name].options.push(label || el.value);
      continue;
    }

    const key = `${type}::${name}::${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    
    const field = { 
      type, label, name, id: el.id, value: el.value, placeholder: el.placeholder,
      autocomplete: el.getAttribute("autocomplete")
    };
    if (type === "select") {
      field.options = [...el.options].map(o => ({ value: o.value, label: o.text.trim() })).filter(o => o.label);
    }
    fields.push(field);
  }
  return fields;
}
