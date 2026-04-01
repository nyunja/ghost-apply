/**
 * Preprocesses raw resume text to normalize whitespace, 
 * merge broken lines, and prepare it for chunking/extraction.
 */
export function preprocess(text) {
  if (!text) return "";

  // 1. Normalize line endings
  let cleaned = text.replace(/\r\n/g, "\n");

  // 2. Remove excessive whitespace within lines (multiple spaces/tabs)
  cleaned = cleaned.split("\n")
    .map(line => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n");

  // 3. Normalize vertical whitespace (max 2 consecutive newlines)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 4. Merge broken lines (often happens in PDFs)
  // Heuristic: If a line is short and doesn't end with punctuation or a bullet, 
  // and the next line starts with a lowercase letter, it's likely broken.
  const lines = cleaned.split("\n");
  const mergedLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let current = lines[i];
    let next = lines[i + 1];

    if (next && 
        current.length > 5 && 
        current.length < 60 && 
        !current.match(/[:;!?\-\u2022\u25CF\u25A0]$/) && 
        next.match(/^[a-z]/)) {
      mergedLines.push(current + " " + next);
      i++; // skip next since it's merged
    } else {
      mergedLines.push(current);
    }
  }

  return mergedLines.join("\n").trim();
}
