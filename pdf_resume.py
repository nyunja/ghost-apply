#!/usr/bin/env python3
"""
pdf_resume.py — Generate ATS-friendly PDF resume and cover letter
from JobTailor CLI output.

Usage:
    python pdf_resume.py resume  <profile.json> <tailored_cv.json> [out.pdf]
    python pdf_resume.py cover   <cover_letter.json>               [out.pdf]
"""

import json, sys, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT

C_ACCENT  = colors.HexColor("#1a1a2e")
C_SUB     = colors.HexColor("#16213e")
C_RULE    = colors.HexColor("#0f3460")
C_KEYWORD = colors.HexColor("#e94560")
C_BODY    = colors.HexColor("#2d2d2d")
C_DIM     = colors.HexColor("#666666")

W, H      = A4
MARGIN_X  = 18 * mm
MARGIN_Y  = 16 * mm


# ── Shared styles ─────────────────────────────────────────────────────────────

def styles():
    return {
        "name":     ParagraphStyle("name",     fontName="Helvetica-Bold",    fontSize=22,   textColor=C_ACCENT, spaceAfter=1,  leading=26),
        "headline": ParagraphStyle("headline", fontName="Helvetica",         fontSize=10.5, textColor=C_SUB,    spaceAfter=4,  leading=14),
        "contact":  ParagraphStyle("contact",  fontName="Helvetica",         fontSize=8.5,  textColor=C_DIM,    spaceAfter=2,  leading=11, alignment=TA_CENTER),
        "section":  ParagraphStyle("section",  fontName="Helvetica-Bold",    fontSize=9,    textColor=C_RULE,   spaceBefore=10, spaceAfter=3, leading=11, letterSpacing=1.2),
        "body":     ParagraphStyle("body",     fontName="Helvetica",         fontSize=9.5,  textColor=C_BODY,   leading=14,    spaceAfter=2,  alignment=TA_JUSTIFY),
        "bullet":   ParagraphStyle("bullet",   fontName="Helvetica",         fontSize=9.5,  textColor=C_BODY,   leading=13.5,  leftIndent=10, bulletIndent=0, spaceAfter=2),
        "role":     ParagraphStyle("role",     fontName="Helvetica-Bold",    fontSize=10,   textColor=C_ACCENT, leading=13,    spaceBefore=6, spaceAfter=1),
        "meta":     ParagraphStyle("meta",     fontName="Helvetica-Oblique", fontSize=8.5,  textColor=C_DIM,    leading=11,    spaceAfter=3),
        "tag":      ParagraphStyle("tag",      fontName="Helvetica-Bold",    fontSize=8,    textColor=C_KEYWORD, leading=10),
        "cl_body":  ParagraphStyle("cl_body",  fontName="Helvetica",         fontSize=10.5, textColor=C_BODY,   leading=16,    spaceAfter=10, alignment=TA_JUSTIFY),
        "cl_meta":  ParagraphStyle("cl_meta",  fontName="Helvetica",         fontSize=9,    textColor=C_DIM,    leading=13,    spaceAfter=2),
    }


def rule():
    return HRFlowable(width="100%", thickness=0.6, color=C_RULE, spaceAfter=4, spaceBefore=0)


def section_header(title, st):
    return [Paragraph(title.upper(), st["section"]), rule()]


# ── Profile normalisation — handles both flat and nested shapes ───────────────

def normalise_profile(p):
    """Return a flat dict regardless of whether p is the old or new profile shape."""
    if "personalInfo" in p:
        pi = p["personalInfo"]
        # skills: flatten all category items
        skill_items = []
        for cat in (p.get("skills") or {}).get("categories", []):
            skill_items.extend(cat.get("items", []))
        # experience roles
        roles = (p.get("experience") or {}).get("roles", [])
        # education items
        edu_items = (p.get("education") or {}).get("items", [])
        edu_list = [
            {
                "title":       e.get("title", ""),
                "institution": e.get("institution", ""),
                "year":        e.get("year", ""),
                "period":      e.get("period", {}),
            }
            for e in edu_items if e.get("title") or e.get("institution")
        ]
        return {
            "name":      pi.get("name", ""),
            "title":     pi.get("title", ""),
            "email":     pi.get("email", ""),
            "phone":     pi.get("phone", ""),
            "location":  pi.get("location", ""),
            "linkedin":  pi.get("linkedin", ""),
            "github":    pi.get("github", ""),
            "website":   pi.get("website", ""),
            "stack":     skill_items,
            "edu_list":  edu_list,
            "roles":     roles,
            "experience": [],
        }
    else:
        # Legacy flat profile.js shape
        return {
            "name":      p.get("name", ""),
            "title":     p.get("title", ""),
            "email":     p.get("email", ""),
            "phone":     p.get("phone", ""),
            "location":  p.get("location", ""),
            "linkedin":  p.get("linkedin", ""),
            "github":    p.get("github", ""),
            "website":   p.get("website", ""),
            "stack":     p.get("stack", []),
            "edu_list":  [],
            "education": p.get("education", ""),
            "roles":     [],
            "experience": p.get("experience", []),
        }


def build_contact_line(p):
    parts = [x for x in [p.get("email"), p.get("phone"), p.get("location"), p.get("linkedin"), p.get("github")] if x]
    return "  ·  ".join(parts)


# ── Resume PDF ────────────────────────────────────────────────────────────────

def generate_resume(profile_raw: dict, cv: dict, out_path: str):
    p  = normalise_profile(profile_raw)
    st = styles()

    doc = SimpleDocTemplate(out_path, pagesize=A4,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_Y,  bottomMargin=MARGIN_Y)

    story = []

    # Header
    story.append(Paragraph(p["name"] or "Your Name", st["name"]))
    story.append(Paragraph(cv.get("headline") or p["title"] or "", st["headline"]))
    story.append(Paragraph(build_contact_line(p), st["contact"]))
    story.append(Spacer(1, 4))
    story.append(rule())

    # Summary
    if cv.get("summary"):
        story += section_header("Professional Summary", st)
        story.append(Paragraph(cv["summary"], st["body"]))
        story.append(Spacer(1, 4))

    # Experience
    story += section_header("Experience", st)

    # Build tailored bullet lookup
    tailored_map = {
        b.get("original", "").strip(): b.get("tailored", "")
        for b in cv.get("injectedBullets", [])
        if b.get("original")
    }

    # New profile shape: experience.roles[]
    for role in p["roles"]:
        title   = role.get("title", "")
        company = role.get("company", "")
        start   = (role.get("period") or {}).get("start", "")
        end     = (role.get("period") or {}).get("end", "")
        period  = f"{start} – {end}".strip(" –") if start or end else ""
        story.append(Paragraph(title, st["role"]))
        story.append(Paragraph(f'{company}  ·  {period}', st["meta"]))
        for bullet in role.get("highlights", []):
            text = tailored_map.get(bullet.strip(), bullet)
            story.append(Paragraph(f"• {text}", st["bullet"]))
        story.append(Spacer(1, 3))

    # Legacy flat shape: experience[]
    for job in p["experience"]:
        story.append(Paragraph(job.get("role", ""), st["role"]))
        story.append(Paragraph(f'{job.get("company","")}  ·  {job.get("duration","")}', st["meta"]))
        for bullet in job.get("bullets", []):
            text = tailored_map.get(bullet.strip(), bullet)
            story.append(Paragraph(f"• {text}", st["bullet"]))
        story.append(Spacer(1, 3))

    # Skills
    if p["stack"]:
        story += section_header("Technical Skills", st)
        story.append(Paragraph(", ".join(p["stack"]), st["body"]))
        story.append(Spacer(1, 4))

    # Education
    edu_list = p.get("edu_list") or []
    edu_str  = p.get("education", "")
    if edu_list or edu_str:
        story += section_header("Education", st)
        if edu_list:
            for e in edu_list:
                title       = e.get("title", "")
                institution = e.get("institution", "")
                year        = e.get("year", "")
                period      = e.get("period") or {}
                start       = period.get("start", "")
                end         = period.get("end", "")
                date_str    = year or (f"{start} - {end}".strip(" -") if start or end else "")
                story.append(Paragraph(title, st["role"]))
                story.append(Paragraph(
                    "  ·  ".join(x for x in [institution, date_str] if x),
                    st["meta"]
                ))
        else:
            # Legacy flat string
            story.append(Paragraph(edu_str, st["body"]))
        story.append(Spacer(1, 4))

    # Keywords
    if cv.get("keywordsInjected"):
        story += section_header("Key Competencies", st)
        tags = "  ·  ".join(
            f'<font color="#e94560"><b>{k}</b></font>'
            for k in cv["keywordsInjected"]
        )
        story.append(Paragraph(tags, st["body"]))
        story.append(Spacer(1, 2))

    doc.build(story)
    print(f"✔  Resume PDF saved → {out_path}")


# ── Cover Letter PDF ──────────────────────────────────────────────────────────

def generate_cover_letter(cl_data: dict, out_path: str):
    """
    cl_data is the cover-letter.json structure:
    { "coverLetter": { "personalInfo": {...}, "jobInfo": {...}, "content": { "opening", "body": [], "closing" } } }
    """
    cl = cl_data.get("coverLetter", cl_data)  # handle both wrapped and unwrapped
    pi = cl.get("personalInfo", {})
    ji = cl.get("jobInfo", {})
    ct = cl.get("content", {})

    st  = styles()
    doc = SimpleDocTemplate(out_path, pagesize=A4,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_Y,  bottomMargin=MARGIN_Y)

    story = []

    # Sender info
    story.append(Paragraph(pi.get("name", ""), st["name"]))
    contact_parts = [x for x in [pi.get("email"), pi.get("phone"), pi.get("location"), pi.get("linkedin")] if x]
    if contact_parts:
        story.append(Paragraph("  ·  ".join(contact_parts), st["contact"]))
    story.append(Spacer(1, 6))
    story.append(rule())
    story.append(Spacer(1, 6))

    # Date + job info
    if ji.get("date"):
        story.append(Paragraph(ji["date"], st["cl_meta"]))
    if ji.get("company") or ji.get("role"):
        story.append(Paragraph(
            f'{ji.get("role", "")} — {ji.get("company", "")}'.strip(" —"),
            st["cl_meta"]
        ))
    story.append(Spacer(1, 10))

    # Body
    if ct.get("opening"):
        story.append(Paragraph(ct["opening"], st["cl_body"]))

    for para in ct.get("body", []):
        if para:
            story.append(Paragraph(para, st["cl_body"]))

    if ct.get("closing"):
        story.append(Paragraph(ct["closing"], st["cl_body"]))

    story.append(Spacer(1, 14))
    story.append(Paragraph(pi.get("name", ""), st["body"]))

    doc.build(story)
    print(f"✔  Cover letter PDF saved → {out_path}")


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "resume":
        if len(sys.argv) < 4:
            print("Usage: python pdf_resume.py resume <profile.json> <tailored_cv.json> [out.pdf]")
            sys.exit(1)
        profile_path = sys.argv[2]
        cv_path      = sys.argv[3]
        out_path     = sys.argv[4] if len(sys.argv) > 4 else cv_path.replace(".json", ".pdf")

        with open(profile_path) as f: profile_data = json.load(f)
        with open(cv_path)      as f: cv_data      = json.load(f)
        generate_resume(profile_data, cv_data, out_path)

    elif mode == "cover":
        cl_path  = sys.argv[2]
        out_path = sys.argv[3] if len(sys.argv) > 3 else cl_path.replace(".json", ".pdf")

        with open(cl_path) as f: cl_data = json.load(f)
        generate_cover_letter(cl_data, out_path)

    else:
        print(f"Unknown mode '{mode}'. Use 'resume' or 'cover'.")
        sys.exit(1)
