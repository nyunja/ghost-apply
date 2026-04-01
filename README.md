# JobTailor CLI

AI-powered job application agent. Analyzes a job description against your profile, rewrites your CV bullets to match, generates tailored PDF resume and cover letter, then opens a browser and fills the application form — with a human-approval step before anything is submitted or logged.

Supports **Claude (Anthropic)**, **Gemini (Google)**, **OpenRouter** (100+ models including free tiers), and **Perplexity (Sonar)** as interchangeable AI providers.

---

## Architecture

| Layer | Path | What it does |
|---|---|---|
| CLI router | `index.js` | Command entry point, routes to handlers |
| Commands | `src/commands/` | `analyze`, `apply`, `batch`, `profile`, `misc` |
| AI services | `src/services/ai/` | JD analysis, CV tailoring, cover letter, form Q&A, profile extraction |
| Resume parser | `src/services/parser/` | Multi-stage hybrid pipeline — section detection, entity extraction, enrichment |
| Browser engine | `src/lib/browser/` | Explorer (headless pre-scrape), apply automation, stealth JD scraper |
| LLM client | `src/lib/llm/client.js` | Provider routing — Claude / Gemini / OpenRouter / Perplexity |
| Profiles | `src/services/profiles.js` | Dynamic profile manager — import, store, switch multiple resumes |
| Selectors | `src/services/selectors.js` | Self-learning selector cache — persists successful CSS selectors per domain |
| Tracker | `src/services/tracker.js` | JSON store — application log, blacklist, daily limit, stats |
| PDF | `pdf_resume.py` | ReportLab — ATS-friendly resume PDF + cover letter PDF |

---

## Setup

```bash
# 1. Install Node dependencies
npm install

# 2. Install Playwright's Chromium browser (one-time)
npx playwright install chromium

# 3. Install Python PDF dependency (one-time)
pip install reportlab

# 4. Set your API key — whichever provider you plan to use
export ANTHROPIC_API_KEY="sk-ant-..."   # Claude
export GEMINI_API_KEY="AIza..."         # Gemini
export OPENROUTER_API_KEY="sk-or-..."  # OpenRouter
export PERPLEXITY_API_KEY="pplx-..."   # Perplexity

# 5. Import your resume to create a profile
node index.js profile add ./resume.pdf   # also accepts .docx, .doc, .txt

# 6. Pick your AI provider (defaults to Claude if skipped)
node index.js config
```

> On first run, any existing `profile.js` data is automatically migrated into `~/.jobtailor/profiles/`.

---

## Commands

```bash
node index.js analyze [url]             # Analyze a JD + tailor CV + cover letter + optional PDFs
node index.js apply [url]               # Full pipeline: explore → tailor → PDFs → fill form → submit
node index.js batch <jobs.txt>          # Loop through a file of URLs, one job per line
node index.js profile <sub>             # Manage profiles (add / list / switch / delete)
node index.js config                    # Switch AI provider and model
node index.js generate-pdf <cv.json>    # Generate resume PDF from a tailored CV JSON
node index.js generate-cover-pdf <cl.json>  # Generate cover letter PDF from a cover-letter JSON
node index.js clear-session             # Clear saved browser cookies (force fresh login)
node index.js history                   # Show recent applications
node index.js stats                     # Show application statistics
node index.js blacklist                 # Add a company to your blacklist
node index.js help                      # Show help + active provider
```

### `apply` / `batch` flags

```bash
--dry-run          Fill the form but do NOT click Submit (safe to test)
--resume <path>    Override the auto-generated resume PDF with a specific file
--cv <path>        Load a previously saved tailored CV JSON (skips the AI step)
--proxy <url>      Route through a proxy: http://user:pass@host:port
```

---

## Profiles

Instead of editing a hardcoded file, import any number of resumes and switch between them. The AI extracts name, title, skills, experience, education, city, and country automatically.

```bash
node index.js profile add ./resume.pdf      # import a PDF resume
node index.js profile add ./resume.docx     # import a Word document
node index.js profile add ./cv-backend.txt  # add a second specialised profile
node index.js profile list                  # list all profiles + which is active
node index.js profile switch                # interactively set the active profile
node index.js profile delete                # remove a profile
```

### How profile extraction works

1. Resume text is extracted from the file (PDF, DOCX, DOC, or TXT)
2. A multi-stage AI pipeline detects sections, extracts entities in parallel, then enriches and categorises skills
3. Location is parsed into separate `city` and `country` fields (e.g. `"Kisumu, Kenya"` → `city: "Kisumu"`, `country: "Kenya"`)
4. The profile is saved as JSON in `~/.jobtailor/profiles/`
5. The active profile is tracked in `~/.jobtailor/config.json`

When you run `analyze`, `apply`, or `batch`:
- One profile → used silently
- Multiple profiles, one active → used (shown in dim text)
- Multiple profiles, none active → prompted to pick one

---

## AI Providers

### Switching provider

```bash
node index.js config
```

### Per-run override

```bash
AI_PROVIDER=gemini AI_MODEL=gemini-1.5-pro node index.js analyze
AI_PROVIDER=claude AI_MODEL=claude-3-5-haiku-20241022 node index.js apply
AI_PROVIDER=openrouter AI_MODEL=deepseek/deepseek-r1:free node index.js batch jobs.txt
```

### Available models

| Provider | Model | Notes |
|---|---|---|
| `claude` | `claude-opus-4-5` | Most capable (default) |
| `claude` | `claude-3-5-sonnet-20241022` | Faster |
| `claude` | `claude-3-5-haiku-20241022` | Cheapest |
| `gemini` | `gemini-2.0-flash` | Fast, cheap (recommended) |
| `gemini` | `gemini-1.5-pro` | More capable |
| `gemini` | `gemini-2.5-pro` | Most capable, slower |
| `perplexity` | `sonar` | Fast, web-grounded |
| `perplexity` | `sonar-pro` | More capable |
| `openrouter` | `qwen/qwen3.6-plus-preview:free` | 72B, best for JSON tasks |
| `openrouter` | `meta-llama/llama-3.3-70b-instruct:free` | 70B, fast |
| `openrouter` | `nvidia/nemotron-3-super-120b-a12b:free` | 120B, strong reasoning |
| `openrouter` | `google/gemini-2.0-flash-exp:free` | Flash, high output limit |
| `openrouter` | `nousresearch/hermes-3-llama-3.1-405b:free` | 405B, best free overall |

---

## Batch apply

Apply to multiple jobs from a plain text file — one URL per line. Lines starting with `#` are treated as comments.

```bash
# jobs.txt
https://job-boards.greenhouse.io/company/jobs/123
https://apply.workable.com/company/j/JOB-ID/
# https://skipped.com/job  ← commented out, will be ignored

node index.js batch jobs.txt
node index.js batch jobs.txt --dry-run
```

The loop:
- Checks the daily limit before each job — stops automatically if hit
- Runs the full pipeline per job with a Human Guard review before each browser session
- Asks "Continue to next job?" between applications so you can stop early
- Prints a summary at the end: applied / skipped / errors

---

## What the pipeline does

### `analyze`

```
Choose input: URL (scrapes), paste, or .txt file
  ↓ AI scores match %, rewrites 3 CV bullets, generates cover letter
  ↓ Human Guard: review rewrites
  ↓ Save CV + cover letter JSON to ~/.jobtailor/outputs/
  ↓ Optional: generate resume PDF + cover letter PDF
```

### `apply` / `batch`

```
Explore job URL (headless browser)
  ↓ Scrapes JD text
  ↓ Walks all form pages, collects every field
  ↓ AI: analyzes JD, tailors CV, writes cover letter
  ↓ AI: answers additional form questions directly from profile
     (country, city, LinkedIn, phone etc. resolved from profile — no AI guessing)
  ↓ Generates Name_Company_Role_CV.pdf + Name_Company_Role_Cover-Letter.pdf
  ↓ Human Guard: review CV, cover letter, and form answers
  ↓ Browser opens, fills all fields using self-learning selector cache
  ↓ Uploads resume PDF + cover letter PDF (auto-detected upload slots)
  ↓ Human Guard: confirm before Submit is clicked
  ↓ Application logged to tracker
```

---

## Self-learning selectors

The tool learns from every successful form interaction and stores selectors in `~/.jobtailor/selectors.json`. On subsequent applications to the same platform, it skips discovery and uses the cached selector directly.

Discovery chain (same for text fields, buttons, and file uploads):
1. **Cache** — check `selectors.json` for this hostname
2. **Heuristics** — try ordered CSS candidates (most specific first)
3. **DOM scan** — scan visible elements by label/placeholder text, build selector
4. **Learn** — save the winning selector for next time

---

## Form Q&A

Before the browser opens, the tool pre-scrapes the application form and generates answers to every non-standard question using your profile. Standard fields (name, email, phone, LinkedIn, location, country) are resolved directly from your profile data — the AI is only called for genuinely unknown questions.

Answers are shown for review in the terminal before the browser opens.

---

## PDF output

Both resume and cover letter are generated as clean, ATS-friendly PDFs using ReportLab.

- Resume: name header, headline (max 8 words), contact line, summary, experience with tailored bullets, skills, education (each entry on its own line), key competencies
- Cover letter: sender info header, date, role/company, opening + body paragraphs + closing

File naming: `John-Paul-Nyunja_Buildkite_Staff-Engineer_CV.pdf` — clean title-case, no timestamp, safe to attach and send.

---

## AI writing style

All prose output (cover letter, CV summary, bullet rewrites) is generated with explicit guardrails:
- No em-dashes, no citation markers like `[1]`
- No AI filler words: "leverage", "robust", "seamlessly", "cutting-edge", etc.
- No filler openers: "I am excited to apply..."
- Varied sentence length
- Every claim grounded in your actual profile — nothing invented

---

## Output files

### `analyze` — saved to `~/.jobtailor/outputs/`

| File | Contents |
|---|---|
| `Name_Company_Role_cv.txt` | Plain-text tailored CV |
| `Name_Company_Role_CV.json` | Structured CV data |
| `Name_Company_Role_CV.pdf` | ATS-ready resume PDF |
| `Name_Company_Role_Cover-Letter.json` | Cover letter data |
| `Name_Company_Role_Cover-Letter.pdf` | Cover letter PDF |

### `apply` / `batch` — saved to `~/.jobtailor/applications/<name_company_role_timestamp>/`

| File | Contents |
|---|---|
| `jd.json` | Job description + analysis metadata |
| `Name_Company_Role_CV.json` | Tailored CV data |
| `Name_Company_Role_CV.pdf` | Resume PDF (auto-uploaded to form) |
| `Name_Company_Role_Cover-Letter.json` | Cover letter data |
| `Name_Company_Role_Cover-Letter.pdf` | Cover letter PDF (auto-uploaded to form) |
| `application-responses.json` | All form Q&A |
| `screenshots/` | Step-by-step browser screenshots |

The application directory name includes a timestamp for tracking (`john-paul-nyunja_buildkite_staff-engineer_1775043161810`). The PDFs inside use clean human-readable names safe to attach to emails.

---

## URL scraping

The stealth scraper (playwright-extra + stealth plugin, headless Chromium) targets platform-specific selectors first, then falls back to generic content selectors:

| Platform | Selectors |
|---|---|
| LinkedIn | `.description__text`, `.jobs-description` |
| Greenhouse | `#content`, `.job__description` |
| Lever | `.posting-description` |
| Indeed | `#jobDescriptionText` |
| Seek | `[data-automation="jobDescription"]` |
| Workday | `[data-automation-id='jobPostingDescription']` |
| Workable | `[data-ui="job-description"]` |
| Any other | `[class*='description']`, `article`, `main` |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required when provider is `claude` |
| `GEMINI_API_KEY` | Required when provider is `gemini` |
| `OPENROUTER_API_KEY` | Required when provider is `openrouter` |
| `PERPLEXITY_API_KEY` | Required when provider is `perplexity` |
| `AI_PROVIDER` | Override saved config for one run: `claude`, `gemini`, `openrouter`, `perplexity` |
| `AI_MODEL` | Override saved model for one run |

---

## Local data

Everything is stored locally — no cloud sync, no external DB.

```
~/.jobtailor/
  config.json               # active provider + model + active profile id
  db.json                   # application log + blacklist
  auth_state.json           # saved browser cookies
  last_action.png           # screenshot of the last browser action
  selectors.json            # learned CSS selectors per domain
  profiles/
    <label>-<ts>.json       # extracted profile JSON
  outputs/                  # analyze command output
  applications/
    <name_company_role_ts>/
      jd.json
      <Name_Company_Role>_CV.json
      <Name_Company_Role>_CV.pdf
      <Name_Company_Role>_Cover-Letter.json
      <Name_Company_Role>_Cover-Letter.pdf
      application-responses.json
      screenshots/
```

---

## File structure

```
index.js                          CLI entry point + command router
pdf_resume.py                     ReportLab PDF generator (resume + cover letter)
src/
  commands/
    analyze.js                    analyze command
    apply.js                      apply + batch commands, applySingleJob()
    profile.js                    profile + generate-pdf + generate-cover-pdf
    misc.js                       config, history, stats, blacklist, clear-session
  lib/
    browser/
      explorer.js                 Unified headless explorer — JD scrape + form probe
      applyAutomation.js          Playwright form filler — self-learning field + upload discovery
      scraper.js                  Stealth JD scraper
    llm/
      client.js                   LLM provider router
  services/
    ai/
      jobAnalysis.js              JD analysis + match scoring
      resumeTailoring.js          CV bullet rewriting
      coverLetter.js              Cover letter generation
      formQuestions.js            Form Q&A — direct profile mapping + AI fallback
      profileExtraction.js        Resume → structured profile
      discovery.js                AI-assisted button/field discovery
    parser/
      pipeline.js                 Multi-stage resume parsing pipeline
      extractor.js                YAML entity extraction
      enricher.js                 Skill categorisation + inference
      merger.js                   Fragment merging for chunked resumes
      sectionDetector.js          Section boundary detection
      preprocessor.js             Text cleaning
    profiles.js                   Profile CRUD + migration
    selectors.js                  Selector cache (read/write selectors.json)
    tracker.js                    Application log + blacklist + daily limit
  utils/
    browserUtils.js               Shared DOM scan functions (scanFields, isStandardField)
    cliHelpers.js                 resolveActiveProfile, buildFilename, requireApiKey
    display.js                    Terminal formatting
```

---

## Rate limiting

The daily limit is enforced in code — the tool stops automatically when the limit is reached. Stick to **5–10 well-matched roles per day**. Sending bulk applications will get your IP flagged and accounts banned.

---

## Not built yet

| Feature | Notes |
|---|---|
| `followup.js` | Gmail follow-up scheduler — reads "Application Received" emails, queues a reply 24h later |
| LinkedIn Easy Apply | Dedicated adapter for LinkedIn's multi-step modal form |
