// ─────────────────────────────────────────────
//  browser.js — Playwright Application Engine
//
//  Features:
//    - Cookie/session persistence (auth_state.json)
//    - Human-like typing with random delays + typos
//    - Screenshot after every step (last_action.png)
//    - Dry-run mode (fills everything, never submits)
//    - Smart field detection for common ATS portals
//    - Proxy support (optional)
// ─────────────────────────────────────────────

import { chromium } from "playwright";
import fs   from "fs";
import path from "path";
import os   from "os";
import { answerFormQuestions } from "../../services/ai/formQuestions.js";
import { getSelector, setSelector } from "../../services/selectors.js";
import { identifyTrigger } from "../../services/ai/discovery.js";
import { scanFields, findClickableCandidates, isStandardField } from "../../utils/browserUtils.js";

// ── Per-field keyword map for dynamic discovery ────────────────────────────
// Each entry lists label/placeholder keywords to recognise that field on any site.
const FIELD_KEYWORDS = {
  full_name:   ["full name", "your name", "nom complet"],
  first_name:  ["first name", "given name", "fname", "forename"],
  last_name:   ["last name", "surname", "family name", "lname"],
  email:       ["email", "e-mail", "electronic mail"],
  phone:       ["phone", "mobile", "cell", "telephone", "tel"],
  location:    ["city", "location", "where are you based", "current location"],
  linkedin:    ["linkedin", "linkedin url", "linkedin profile", "linkedin.com"],
  github:      ["github", "github url", "github profile", "github.com", "code repository"],
  website:     ["website", "portfolio", "personal url", "personal site", "online portfolio"],
  cover:       ["cover letter", "covering letter", "motivation", "why do you want"],
};

const DATA_DIR    = path.join(os.homedir(), ".jobtailor");
const AUTH_STATE  = path.join(DATA_DIR, "auth_state.json");
let SCREENSHOTS   = path.join(DATA_DIR, "screenshots");
const LAST_ACTION = path.join(DATA_DIR, "last_action.png");

fs.mkdirSync(DATA_DIR,    { recursive: true });
fs.mkdirSync(SCREENSHOTS, { recursive: true });

// ── Utilities ────────────────────────────────
const sleep       = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min)) + min;

// ── Shared focus helper ───────────────────────
async function focusLocator(locator) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
    await locator.click({ timeout: 5000 });
  } catch {
    // Overlay intercepting — focus via JS
    await locator.evaluate(el => el.focus()).catch(() => {});
  }
  await locator.clear().catch(() => {});
}

// ── Human-like typing — short fields ─────────
// Fast cadence for name, email, phone, URLs.
async function humanType(locator, text) {
  await focusLocator(locator);
  for (let i = 0; i < text.length; i++) {
    // 4% typo rate
    if (Math.random() < 0.04 && i < text.length - 1) {
      const typo = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
      await locator.pressSequentially(typo, { delay: randomDelay(30, 70) });
      await locator.press("Backspace");
      await sleep(randomDelay(20, 50));
    }
    await locator.pressSequentially(text[i], { delay: randomDelay(30, 90) });
    if (text[i] === " ") await sleep(randomDelay(15, 50));
  }
}

// ── Human-like typing — composing mode ───────
// For textareas and long AI-generated answers: fast between words but with
// randomised "thinking" pauses after punctuation and paragraph breaks —
// simulates someone who types quickly but pauses to read back their writing.
async function humanTypeCompose(locator, text) {
  await focusLocator(locator);
  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1] ?? "";

    // 3% typo rate — lower than short fields (you've drafted this already)
    if (Math.random() < 0.03 && i < text.length - 1) {
      const typo = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
      await locator.pressSequentially(typo, { delay: randomDelay(25, 65) });
      await locator.press("Backspace");
      await sleep(randomDelay(80, 200)); // brief correction pause
    }

    await locator.pressSequentially(ch, { delay: randomDelay(25, 70) });

    // ── Thinking pauses ──────────────────────────────────────────────────
    if (ch === "\n") {
      // Paragraph break — longest pause (re-reading what was written)
      await sleep(randomDelay(700, 1600));
    } else if (".!?".includes(ch) && next === " ") {
      // End of sentence — medium-long composing pause
      await sleep(randomDelay(350, 850));
    } else if (",;:".includes(ch) && next === " ") {
      // Clause break — short thinking pause
      await sleep(randomDelay(150, 420));
    } else if (ch === " " && Math.random() < 0.04) {
      // ~4% of word gaps: random mid-thought hesitation
      await sleep(randomDelay(300, 900));
    }
  }
}

// ── Hidden input fill ─────────────────────────
// For aria-hidden backing inputs (e.g. Workable's city autocomplete) that
// sit behind a custom widget — set value via JS + dispatch input/change events.
async function fillHiddenInput(page, selector, value) {
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    // Use React/Vue-compatible setter so frameworks detect the change
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, val); else el.value = val;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
}

// ── Screenshots ──────────────────────────────
async function screenshot(page, label) {
  const file = path.join(SCREENSHOTS, `${Date.now()}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.screenshot({ path: LAST_ACTION }); // always update last_action.png
  return file;
}

// ── Session helpers ──────────────────────────
function hasAuthState() {
  return fs.existsSync(AUTH_STATE);
}

async function saveAuthState(context) {
  await context.storageState({ path: AUTH_STATE });
  console.log(`  ✔ Session saved → ${AUTH_STATE}`);
}

export function clearAuthState() {
  if (fs.existsSync(AUTH_STATE)) {
    fs.unlinkSync(AUTH_STATE);
    console.log("  ✔ Auth state cleared — will require fresh login next run");
  }
}

// ── Browser factory ──────────────────────────
async function launchBrowser(opts = {}) {
  const launchOpts = {
    headless: opts.headless ?? false,  // visible by default so you can intervene
    slowMo:   opts.slowMo  ?? 80,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
  };

  if (opts.proxy) {
    launchOpts.proxy = {
      server:   opts.proxy.server,
      username: opts.proxy.username,
      password: opts.proxy.password,
    };
  }

  const browser = await chromium.launch(launchOpts);

  const contextOpts = {
    viewport:   { width: 1280 + randomDelay(0, 80), height: 800 + randomDelay(0, 40) },
    userAgent:  opts.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale:     "en-US",
    timezoneId: opts.timezone ?? "America/New_York",
  };

  // Reuse saved cookies/localStorage if available
  if (hasAuthState() && !opts.freshSession) {
    contextOpts.storageState = AUTH_STATE;
    console.log("  › Loaded saved session from auth_state.json");
  }

  const context = await browser.newContext(contextOpts);
  const page    = await context.newPage();

  // Skip images/fonts — faster navigation
  await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", r => r.abort());

  return { browser, context, page };
}

// ── Field helpers ────────────────────────────
async function findField(page, candidates) {
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) return el;
    } catch { /* try next selector */ }
  }
  return null;
}

// compose=true → humanTypeCompose (textareas / long-form answers)
// compose=false → humanType (short fields: name, email, phone, …)
async function fillField(page, candidates, value, compose = false) {
  if (!value) return false;

  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) continue;

      // aria-hidden="true" inputs are backing stores for custom widgets —
      // set value via JS instead of trying to click them.
      const isAriaHidden = await el.evaluate(
        n => n.getAttribute("aria-hidden") === "true"
      ).catch(() => false);

      if (isAriaHidden) {
        await fillHiddenInput(page, sel, value);
      } else {
        await (compose ? humanTypeCompose(el, value) : humanType(el, value));
      }
      return true;
    } catch { /* try next selector */ }
  }

  // Last resort: force-set value on the first selector that exists in the DOM
  for (const sel of candidates) {
    const filled = await fillHiddenInput(page, sel, value).catch(() => false);
    if (filled) return true;
  }

  return false;
}

// ── Field Discovery Chain ─────────────────────
// 1. Cache (selectors.json fields)
// 2. Heuristics (hardcoded CSS candidates)
// 3. Dynamic label scan — finds by keyword match, learns selector
//
// fieldName  — key from FIELD_KEYWORDS (e.g. "linkedin")
// candidates — hardcoded CSS selector array
// value      — the value to type
// hostname   — e.g. "job-boards.greenhouse.io"
async function fillWithDiscovery(page, fieldName, candidates, value, hostname, compose = false) {
  if (!value) return false;

  // 1. Cached selector
  const cached = getSelector(hostname, fieldName, "fields");
  if (cached) {
    const filled = await fillField(page, [cached], value, compose);
    if (filled) {
      console.log(`  › [CACHE] Filled ${fieldName} using cached selector: ${cached}`);
      return true;
    }
    // Cached selector is stale — fall through to re-discover
    console.log(`  › [CACHE MISS] Cached selector ${cached} for ${fieldName} failed.`);
  }

  // 2. Heuristics — standard CSS candidates
  const heuristicFilled = await fillField(page, candidates, value, compose);
  if (heuristicFilled) {
    // Learn whichever selector worked — Playwright doesn't tell us which one,
    // so re-probe to find the filled input and capture its id/name.
    const learned = await page.evaluate(({ cands }) => {
      for (const sel of cands) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          if (el.id)   return `#${el.id}`;
          if (el.name) return `[name="${el.name}"]`;
          return sel; // fall back to whatever matched
        }
      }
      return null;
    }, { cands: candidates }).catch(() => null);

    if (learned) setSelector(hostname, fieldName, learned, "fields");
    console.log(`  › [HEURISTIC] Filled ${fieldName}. Learned: ${learned || "(none)"}`);
    return true;
  }

  // 3. Dynamic label scan — look for any visible input whose label/placeholder
  console.log(`  › [DISCOVERY] Heuristics failed for ${fieldName}, invoking dynamic scan...`);

  //    contains one of the keywords for this field type.
  const keywords = FIELD_KEYWORDS[fieldName] ?? [fieldName];
  const discovered = await page.evaluate(({ kws }) => {
    const getLabel = el => {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return lbl.innerText.trim().toLowerCase();
      }
      const wrap = el.closest("label");
      if (wrap) return wrap.innerText.trim().toLowerCase();
      const fs = el.closest("fieldset");
      if (fs) { const lg = fs.querySelector("legend"); if (lg) return lg.innerText.trim().toLowerCase(); }
      const parent = el.closest('[class*="field"],[class*="question"],[class*="form-group"],[class*="input-wrap"]');
      if (parent) {
        for (const c of parent.querySelectorAll("label,p,span,[class*='label']")) {
          const t = c.innerText?.trim()?.toLowerCase();
          if (t && !c.contains(el)) return t;
        }
      }
      return (el.placeholder || el.name || el.id || "").toLowerCase();
    };

    for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=submit]), textarea")) {
      if (el.disabled || el.readOnly) continue;
      if (window.getComputedStyle(el).display === "none") continue;
      const label = getLabel(el);
      if (kws.some(k => label.includes(k))) {
        // Build a precise selector — prefer id, then name
        if (el.id)   return { sel: `#${CSS.escape(el.id)}`,       label };
        if (el.name) return { sel: `[name="${el.name}"]`,        label };
      }
    }
    return null;
  }, { kws: keywords }).catch(() => null);

  if (discovered) {
    console.log(`  › [DISCOVERY] Found ${fieldName} via label '${discovered.label}', filling...`);
    const filled = await fillField(page, [discovered.sel], value, compose);
    if (filled) {
      setSelector(hostname, fieldName, discovered.sel, "fields");
      console.log(`  › [DISCOVERY SUCCESS] Learned new selector for ${fieldName}: ${discovered.sel}`);
      return true;
    }
    console.log(`  › [DISCOVERY FAIL] Found selector but could not fill: ${discovered.sel}`);
  } else {
    console.log(`  › [DISCOVERY FAIL] No matching labels found for ${fieldName}.`);
  }

  return false;
}

const UPLOAD_KEYWORDS = {
  resume:       ["resume", "cv", "curriculum", "upload your resume", "attach resume"],
  cover_letter: ["cover letter", "covering letter", "cover", "letter of motivation"],
};

// ── File upload with discovery chain ─────────
// Same Cache → Heuristics → DOM scan → Learn pattern as fillWithDiscovery.
async function uploadFile(page, fieldName, filePath, hostname, log) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  // 1. Cached selector
  const cached = getSelector(hostname, fieldName, "fields");
  if (cached) {
    try {
      const el = page.locator(cached).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.setInputFiles(filePath);
        log(`  › [CACHE] Uploaded ${fieldName} via cached selector: ${cached}`);
        setSelector(hostname, fieldName, cached, "fields");
        return true;
      }
    } catch { /* stale — fall through */ }
    log(`  › [CACHE MISS] ${fieldName} cached selector stale, re-discovering...`);
  }

  // 2. Heuristics — ordered by specificity
  const HEURISTICS = {
    resume: [
      'input[type="file"][name*="resume" i]',
      'input[type="file"][name*="cv" i]',
      'input[type="file"][id*="resume" i]',
      'input[type="file"][id*="cv" i]',
      '[data-automation-id="file-upload-input"]',
      '[data-ui="file-upload"] input[type="file"]',
      '.resume-upload input[type="file"]',
      'input[type="file"][accept*="pdf" i]',
    ],
    cover_letter: [
      'input[type="file"][name*="cover" i]',
      'input[type="file"][name*="letter" i]',
      'input[type="file"][id*="cover" i]',
      'input[type="file"][id*="letter" i]',
    ],
  };

  for (const sel of (HEURISTICS[fieldName] ?? [])) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await el.setInputFiles(filePath);
      setSelector(hostname, fieldName, sel, "fields");
      log(`  › [HEURISTIC] Uploaded ${fieldName}. Learned: ${sel}`);
      return true;
    } catch { /* try next */ }
  }

  // 3. Dynamic DOM scan — find file inputs by label context
  log(`  › [DISCOVERY] Heuristics failed for ${fieldName}, scanning DOM...`);
  const keywords = UPLOAD_KEYWORDS[fieldName] ?? [fieldName];

  const discovered = await page.evaluate(({ kws }) => {
    const getUploadLabel = el => {
      // Check label[for], wrapping label, aria-label, surrounding text
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return lbl.innerText.trim().toLowerCase();
      }
      const wrap = el.closest("label");
      if (wrap) return wrap.innerText.trim().toLowerCase();
      const parent = el.closest('[class*="upload"],[class*="file"],[class*="attach"],[class*="document"],[class*="field"]');
      if (parent) {
        for (const c of parent.querySelectorAll("label,span,p,h3,h4,[class*='label'],[class*='title']")) {
          const t = c.innerText?.trim()?.toLowerCase();
          if (t && t.length < 80 && !c.contains(el)) return t;
        }
      }
      return (el.getAttribute("aria-label") || el.name || el.id || "").toLowerCase();
    };

    for (const el of document.querySelectorAll('input[type="file"]')) {
      if (el.disabled) continue;
      const label = getUploadLabel(el);
      if (kws.some(k => label.includes(k))) {
        if (el.id)   return { sel: `#${CSS.escape(el.id)}`, label };
        if (el.name) return { sel: `[name="${el.name}"]`, label };
        // Build nth-of-type selector as fallback
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const idx = inputs.indexOf(el);
        return { sel: `input[type="file"]:nth-of-type(${idx + 1})`, label };
      }
    }
    return null;
  }, { kws: keywords }).catch(() => null);

  if (discovered) {
    try {
      const el = page.locator(discovered.sel).first();
      await el.setInputFiles(filePath);
      setSelector(hostname, fieldName, discovered.sel, "fields");
      log(`  › [DISCOVERY] Uploaded ${fieldName} via label "${discovered.label}". Learned: ${discovered.sel}`);
      return true;
    } catch (err) {
      log(`  › [DISCOVERY FAIL] Found selector but upload failed: ${err.message?.split("\n")[0]}`);
    }
  } else {
    log(`  › [DISCOVERY FAIL] No matching upload field found for ${fieldName}.`);
  }

  return false;
}

// ── Apply AI answers to form fields ──────────
async function applyAnswers(page, answeredQuestions, log) {
  for (const { question, answer } of answeredQuestions) {
    if (!answer || /^(not provided|n\/a)$/i.test(answer.trim())) continue;
    const { id, type, name, options, label } = question;
    const byId   = id   ? `#${id}`           : null;
    const byName = name ? `[name="${name}"]`  : null;
    const sel    = byId || byName;
    if (!sel) continue;

    try {
      if (type === "select") {
        const match = options.find(o =>
          o.label.toLowerCase().includes(answer.toLowerCase()) ||
          answer.toLowerCase().includes(o.label.toLowerCase())
        );
        if (match) {
          await page.locator(sel).first()
            .selectOption({ value: match.value })
            .catch(() => page.locator(sel).first().selectOption({ label: match.label }));
        }

      } else if (type === "radio") {
        const match = options.find(o =>
          o.label.toLowerCase().includes(answer.toLowerCase()) ||
          answer.toLowerCase().includes(o.label.toLowerCase())
        );
        if (match) {
          // Workable radio inputs are aria-hidden="true" — clicking them directly
          // does nothing.  Click the [data-ui="option"] wrapper div instead.
          // Fall back to the <label> wrapping the input, then a JS .click() on the input.
          const radioInput = page.locator(`[name="${name}"][value="${match.value}"]`).first();
          await radioInput.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

          const clicked = await radioInput.evaluate(input => {
            // 1. Workable: click the [data-ui="option"] ancestor
            const optionWrapper = input.closest("[data-ui='option']");
            if (optionWrapper) { optionWrapper.click(); return "option-wrapper"; }
            // 2. Click the wrapping <label>
            const lbl = input.closest("label");
            if (lbl) { lbl.click(); return "label"; }
            // 3. Direct JS click on the (hidden) input
            input.click();
            return "input-direct";
          }).catch(() => null);

          if (!clicked) {
            // Last resort: Playwright click on the wrapper
            await page.locator(`[data-ui="option"]:has([name="${name}"][value="${match.value}"])`).first()
              .click({ timeout: 3000 }).catch(() => {});
          }
        }

      } else if (type === "checkbox") {
        const shouldCheck = /yes|true|agree|accept|i (do|am|have)/i.test(answer);
        const el = page.locator(sel).first();
        const isChecked = await el.isChecked().catch(() => false);
        if (shouldCheck !== isChecked) await el.click().catch(() => {});

      } else {
        // text / number → humanType (fast); textarea → humanTypeCompose (thinking pauses)
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await (type === "textarea"
            ? humanTypeCompose(el, String(answer))
            : humanType(el, String(answer)));
        }
      }

      log(`✔ "${label}" → ${answer}`);
    } catch (err) {
      log(`⚠  Skipped "${label}": ${err.message?.split("\n")[0]}`);
    }
  }
}

/**
 * Intelligent button clicker with self-learning capabilities.
 * Discovery Chain: Cache -> Heuristics -> AI Discovery
 */
async function clickButton(page, action, candidates, log = console.log) {
  const hostname = new URL(page.url()).hostname;

  // 1. Check Cache
  const cached = getSelector(hostname, action);
  if (cached) {
    try {
      const el = page.locator(cached).first();
      if (await el.isVisible({ timeout: 2500 }).catch(() => false)) {
        await el.click({ timeout: 5000 }).catch(() => el.evaluate(n => n.click()));
        return true;
      }
    } catch { /* if cached fails, fall back */ }
  }

  // 2. Heuristics (hardcoded candidates)
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await el.click({ timeout: 5000 }).catch(() => el.evaluate(n => n.click()));
      
      // Found a winner! Persist it.
      setSelector(hostname, action, sel);
      return true;
    } catch { /* try next */ }
  }

  // 3. AI Discovery Fallback
  log(`    ⚠ Heuristics failed for "${action}". Invoking AI discovery...`);
  const clickableCandidates = await page.evaluate(findClickableCandidates);
  const bestIndex = await identifyTrigger(action, clickableCandidates);

  if (bestIndex !== null) {
    const success = await page.evaluate(({ idx }) => {
      const els = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]');
      const target = Array.from(els).filter(e => e.offsetWidth > 0)[idx];
      if (target) { target.click(); return true; }
      return false;
    }, { idx: bestIndex });

    if (success) {
      const learnedSelector = `button, a >> nth=${bestIndex}`;
      setSelector(hostname, action, learnedSelector);
      return true;
    }
  }

  return false;
}

// ── Manual login pause ────────────────────────
function waitForUserInput(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

// ── Main apply function ───────────────────────
// opts.coverLetter  — full cover letter text (pre-generated) — overrides coverLineSuggestion
// opts.preAnswers   — [{ question, answer }] pre-fetched by scrapeFormQuestions (skips mid-session AI scan)
export async function applyToJob(url, tailoredCV, profile, opts = {}) {
  const dryRun  = opts.dryRun  ?? false;
  const verbose = opts.verbose ?? true;
  const log = (msg) => { if (verbose) console.log(`  ${msg}`); };

  log(dryRun
    ? "🧪 DRY RUN — will fill form but NOT click Submit"
    : "🚀 LIVE — will submit application");

  const { browser, context, page } = await launchBrowser(opts);

  try {
    if (opts.appDir) {
      SCREENSHOTS = path.join(opts.appDir, "screenshots");
      fs.mkdirSync(SCREENSHOTS, { recursive: true });
    }

    // ── Step 1: Navigate ──────────────────────
    log(`› Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(randomDelay(1200, 2200));
    await screenshot(page, "01-loaded");

    // ── Step 2: Handle login wall ─────────────
    const loginWall = await findField(page, [
      'input[type="password"]',
      'button:has-text("Sign in")',
      'a:has-text("Log in")',
      'button:has-text("Log In")',
    ]);

    if (loginWall && !hasAuthState()) {
      log("⚠  Login required — complete it in the browser window, then press Enter");
      await waitForUserInput("  Press Enter once you are logged in... ");
      await saveAuthState(context);
      await sleep(randomDelay(800, 1500));
    }

    await screenshot(page, "02-post-login");

    // ── Step 3: Click Apply ───────────────────
    log("› Looking for Apply button...");
    const clickedApply = await clickButton(page, "apply", [
      'button:has-text("Apply Now")',
      'button:has-text("Easy Apply")',
      'button:has-text("Apply")',
      'button:has-text("I\'m interested")',
      'button:has-text("Interested")',
      'a:has-text("Apply Now")',
      'a:has-text("Apply")',
      'a:has-text("I\'m interested")',
      '[data-ui="apply-button"]',               // Workable
      '[data-automation="job-detail-apply"]',   // Seek
      '.jobs-apply-button',                     // LinkedIn
      '#apply-button',
      '[aria-label*="Apply"]',
      '[data-cy="apply-button"]',               // Greenhouse
    ], log);

    if (!clickedApply) {
      log("⚠  Could not find Apply button — check last_action.png");
      await screenshot(page, "03-no-apply-btn");
      return { success: false, reason: "apply_button_not_found" };
    }

    await sleep(randomDelay(1500, 2500));
    await screenshot(page, "03-apply-form-open");

    // ── Step 4: Fill personal fields ─────────
    log("› Filling personal details...");
    const host = new URL(url).hostname;
    const pInfo = profile.personalInfo || profile;

    await fillWithDiscovery(page, "full_name", [
      'input[autocomplete="name"]',
      'input[name*="full_name" i]',
      'input[id*="full-name" i]',
      'input[placeholder*="full name" i]',
    ], pInfo.name, host);

    await fillWithDiscovery(page, "first_name", [
      'input[autocomplete="given-name"]',
      'input[name*="first_name" i]', 'input[name*="firstName" i]',
      'input[id*="first-name" i]',   'input[placeholder*="first name" i]',
    ], pInfo.name?.split(" ")[0], host);

    await fillWithDiscovery(page, "last_name", [
      'input[autocomplete="family-name"]',
      'input[name*="last_name" i]',  'input[name*="lastName" i]',
      'input[id*="last-name" i]',    'input[placeholder*="last name" i]',
    ], pInfo.name?.split(" ").slice(1).join(" "), host);

    await fillWithDiscovery(page, "email", [
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
    ], pInfo.email, host);

    if (pInfo.phone) {
      await fillWithDiscovery(page, "phone", [
        'input[type="tel"]',
        'input[autocomplete="tel"]',
        'input[name*="phone" i]',
        'input[id*="phone" i]',
        'input[name*="mobile" i]',
        'input[id*="mobile" i]',
        'input[placeholder*="phone" i]',
        'input[placeholder*="mobile" i]',
        '[data-role="illustrated-input"]:has(input[name*="phone" i]) input:not([aria-hidden="true"])',
        '[data-role="illustrated-input"]:has(input[type="tel"]) input:not([aria-hidden="true"])',
      ], pInfo.phone, host);
    }

    await fillWithDiscovery(page, "location", [
      'input[autocomplete="address-level2"]',
      'input[name*="location" i]:not([aria-hidden="true"])',
      'input[name*="city" i]:not([aria-hidden="true"])',
      'input[placeholder*="city" i]:not([aria-hidden="true"])',
      'input[placeholder*="location" i]:not([aria-hidden="true"])',
      'input[id*="location" i]:not([aria-hidden="true"])',
      'input[id*="city" i]:not([aria-hidden="true"])',
      '[data-role="illustrated-input"]:has(input[name*="location" i]) input:not([aria-hidden="true"])',
      '[data-role="illustrated-input"]:has(input[name*="city" i]) input:not([aria-hidden="true"])',
      '[data-role="illustrated-input"]:has(input[placeholder*="city" i]) input:not([aria-hidden="true"])',
      'input[name*="city" i]',
    ], pInfo.location, host);

    // ── Step 5: Fill profile links ────────────
    if (pInfo.linkedin) {
      await fillWithDiscovery(page, "linkedin", [
        'input[name*="linkedin" i]', 'input[id*="linkedin" i]',
        'input[placeholder*="linkedin" i]',
        'input[aria-label*="linkedin" i]',
      ], pInfo.linkedin, host);
    }

    if (pInfo.github || pInfo.website) {
      await fillWithDiscovery(page, "github", [
        'input[name*="github" i]',   'input[name*="portfolio" i]',
        'input[name*="website" i]',  'input[id*="github" i]',
        'input[placeholder*="github" i]', 'input[placeholder*="portfolio" i]',
        'input[aria-label*="github" i]', 'input[aria-label*="portfolio" i]',
      ], pInfo.github || pInfo.website, host);
    }

    // ── Step 6: Cover letter / summary ─────────
    // Prefer the pre-generated full cover letter; fall back to the one-liner + summary
    const coverText = opts.coverLetter
      ? opts.coverLetter
      : [tailoredCV.coverLineSuggestion, "", tailoredCV.summary].filter(Boolean).join("\n");

    if (coverText) {
      log(opts.coverLetter
        ? "› Typing full cover letter (compose mode)..."
        : "› Typing cover line + summary...");
    }

    await fillField(page, [
      'textarea[name*="cover" i]',   'textarea[id*="cover" i]',
      'textarea[placeholder*="cover" i]',
      'textarea[name*="message" i]', 'textarea[id*="message" i]',
      'textarea[name*="summary" i]', 'textarea[name*="letter" i]',
      '#cover-letter', '#coverLetter', '[data-cy="cover-letter"]',
    ], coverText, true);  // compose=true — thinking pauses between sentences

    await sleep(randomDelay(800, 1500));
    await screenshot(page, "04-form-filled");

    // ── Step 6.5–6.6: Additional questions + multi-step navigation ──
    // If pre-answers were supplied from scrapeFormQuestions, apply them directly
    // on the first step and skip the AI call.  For subsequent steps (multi-page
    // forms) fall back to the normal mid-session scan.
    const preAnswers = opts.preAnswers ?? [];
    const MAX_STEPS = 3;
    for (let step = 1; step <= MAX_STEPS; step++) {
      let answered;

      if (step === 1 && preAnswers.length) {
        // Use pre-fetched answers — no extra AI call needed
        log(`› Applying ${preAnswers.length} pre-fetched answer(s) on step 1...`);
        answered = preAnswers;
      } else {
        const allFields = await page.evaluate(scanFields);
        const extraQs = allFields.filter(f => !isStandardField(f));

        if (!extraQs.length) {
          log(`› No additional questions found on step ${step}`);
          // Still try to advance to next page
          const clickedNext = await clickButton(page, "next", [
            'button:has-text("Next")', 'button:has-text("Continue")',
            'button[data-ui="next"]', 'button[data-action="next"]',
            '[data-cy="next-step"]', 'button:has-text("Next Step")',
            'a[role="button"]:has-text("Next")',
          ], log);
          if (!clickedNext) break;
          log(`› Multi-step form: advanced to step ${step + 1}`);
          await sleep(randomDelay(1500, 2500));
          await screenshot(page, `04${String.fromCharCode(96 + step)}-next-step`);
          continue;
        }
        log(`› Found ${extraQs.length} additional question(s) on step ${step} — asking AI...`);
        try {
          answered = await answerFormQuestions(extraQs, profile, tailoredCV);
        } catch (err) {
          log(`⚠  Additional questions failed: ${err.message?.split("\n")[0]}`);
        }
      }  // end else branch (scan-based answering)

      // Apply the answers we collected (pre-fetched or freshly-generated)
      if (answered?.length) {
        log(`› Filling ${answered.length} answer(s) on step ${step}...`);
        await applyAnswers(page, answered, log);
        await sleep(randomDelay(600, 1200));
        await screenshot(page, `04${String.fromCharCode(96 + step)}-extra-q-step${step}`);
      }

      // Advance to the next form page if a Next/Continue button exists
      const clickedNext = await clickButton(page, "next", [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button[data-ui="next"]',
        'button[data-action="next"]',
        '[data-cy="next-step"]',
        'button:has-text("Next Step")',
        'a[role="button"]:has-text("Next")',
      ], log);

      if (!clickedNext) break;   // No more steps — we're on the final page

      log(`› Multi-step form: advanced to step ${step + 1}`);
      await sleep(randomDelay(1500, 2500));
      await screenshot(page, `04${String.fromCharCode(96 + step)}-next-step`);
    }

    // ── Step 7: Upload documents ──────────────
    const resolvedResumePath = opts.resumePath
      ?? (opts.appDir ? (() => {
          const f = fs.readdirSync(opts.appDir).find(f => f.endsWith("_CV.pdf"));
          return f ? path.join(opts.appDir, f) : null;
        })() : null);

    const resolvedCoverPath = opts.coverLetterPath
      ?? (opts.appDir ? (() => {
          const f = fs.readdirSync(opts.appDir).find(f => f.endsWith("_Cover-Letter.pdf"));
          return f ? path.join(opts.appDir, f) : null;
        })() : null);

    const host2 = new URL(url).hostname;

    if (resolvedResumePath) {
      const uploaded = await uploadFile(page, "resume", resolvedResumePath, host2, log);
      if (uploaded) {
        await page.waitForFunction(
          name => document.body.innerText.includes(name),
          path.basename(resolvedResumePath),
          { timeout: 8000 }
        ).catch(() => {});
        await sleep(randomDelay(1000, 2000));
        log("✔ Resume uploaded");
        await screenshot(page, "05-resume-uploaded");
      }
    }

    if (resolvedCoverPath) {
      const uploaded = await uploadFile(page, "cover_letter", resolvedCoverPath, host2, log);
      if (uploaded) {
        await page.waitForFunction(
          name => document.body.innerText.includes(name),
          path.basename(resolvedCoverPath),
          { timeout: 8000 }
        ).catch(() => {});
        await sleep(randomDelay(1000, 2000));
        log("✔ Cover letter uploaded");
        await screenshot(page, "05-cover-uploaded");
      }
    }

    // ── Step 8: Submit (or skip if dry run) ───
    if (dryRun) {
      log("🧪 DRY RUN complete — form filled, Submit skipped");
      log(`   Screenshots saved to: ${SCREENSHOTS}`);
      await sleep(2500);
      return { success: true, dryRun: true };
    }

    log("› Submitting application...");
    const submitted = await clickButton(page, "submit", [
      '[data-automation="submit-application"]',
      '[data-cy="submit-application"]',
      'button[type="submit"]:has-text("Submit")',
      'button:has-text("Submit Application")',
      'button:has-text("Send Application")',
      'button:has-text("Submit")',
      'input[type="submit"]',
    ], log);

    if (!submitted) {
      log("⚠  Submit button not found — check last_action.png");
      await screenshot(page, "06-no-submit");
      return { success: false, reason: "submit_button_not_found" };
    }

    await sleep(randomDelay(2500, 4000));
    await screenshot(page, "06-post-submit");

    // ── Step 9: Detect success confirmation ───
    const bodyText = ((await page.textContent("body")) ?? "").toLowerCase();
    const successPatterns = [
      /application.{0,20}received/,
      /thank.{0,10}you.{0,20}appl/,
      /successfully.{0,20}submitted/,
      /we.{0,20}received.{0,20}your/,
      /application.{0,20}complete/,
    ];
    const confirmed = successPatterns.some(r => r.test(bodyText));

    if (confirmed) {
      log("✔ Application submitted and confirmed!");
    } else {
      log("⚠  Submitted but could not confirm success page — check last_action.png");
    }

    // Save fresh session cookies
    await saveAuthState(context);

    return { success: true, confirmed, dryRun: false };

  } catch (err) {
    await screenshot(page, "error").catch(() => {});
    throw err;
  } finally {
    await sleep(1000);
    await browser.close();
  }
}
