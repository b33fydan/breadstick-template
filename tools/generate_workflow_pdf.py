"""Generate a PDF briefing on how to work better with Claude.
Content synthesized from his /insights report — actionable, not philosophical.
Written for the Breadstick project but general enough to apply across his work.
"""
from pathlib import Path

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    ListFlowable, ListItem, Table, TableStyle, HRFlowable,
)

OUT_DIR = Path(__file__).resolve().parent.parent / "renders" / "docs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = OUT_DIR / "working_with_claude_better.pdf"

GOLD = HexColor("#C9A227")
INK = HexColor("#1a1a1a")
MUTED = HexColor("#555555")
ACCENT = HexColor("#0f766e")
BG_CALLOUT = HexColor("#f4efe0")

styles = getSampleStyleSheet()

H1 = ParagraphStyle(
    "H1", parent=styles["Heading1"],
    fontSize=26, leading=32, textColor=INK, spaceAfter=14, spaceBefore=0,
    fontName="Helvetica-Bold",
)
H2 = ParagraphStyle(
    "H2", parent=styles["Heading2"],
    fontSize=18, leading=22, textColor=GOLD, spaceAfter=8, spaceBefore=18,
    fontName="Helvetica-Bold",
)
H3 = ParagraphStyle(
    "H3", parent=styles["Heading3"],
    fontSize=13, leading=17, textColor=ACCENT, spaceAfter=4, spaceBefore=10,
    fontName="Helvetica-Bold",
)
BODY = ParagraphStyle(
    "Body", parent=styles["BodyText"],
    fontSize=11, leading=16, textColor=INK, spaceAfter=6, alignment=TA_LEFT,
    fontName="Helvetica",
)
MUTED_P = ParagraphStyle(
    "Muted", parent=BODY, textColor=MUTED, fontSize=10, leading=14,
)
CODE = ParagraphStyle(
    "Code", parent=BODY, fontName="Courier", fontSize=9.5, leading=13,
    backColor=HexColor("#f2f2f2"), borderPadding=8,
    leftIndent=8, rightIndent=8, spaceAfter=10,
)
CALLOUT = ParagraphStyle(
    "Callout", parent=BODY, backColor=BG_CALLOUT,
    borderPadding=10, borderColor=GOLD, borderWidth=1,
    leftIndent=10, rightIndent=10, spaceAfter=12, fontSize=10.5, leading=15,
)


def hr():
    return HRFlowable(width="100%", color=HexColor("#dddddd"), spaceBefore=4, spaceAfter=10)


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, BODY), leftIndent=14) for t in items],
        bulletType="bullet", bulletColor=GOLD, leftIndent=12,
    )


def code_block(text):
    """Preserves leading spaces and newlines in monospace."""
    safe = (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace(" ", "&nbsp;")
                .replace("\n", "<br/>"))
    return Paragraph(safe, CODE)


def callout(text):
    return Paragraph(text, CALLOUT)


def build():
    doc = SimpleDocTemplate(
        str(OUT_PATH), pagesize=letter,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.8 * inch,
        title="Working With Claude Better — Breadstick Operator Playbook",
        author="Claude",
    )

    story = []

    # ── Cover
    story.append(Paragraph("Working With Claude Better", H1))
    story.append(Paragraph("A six-section operator playbook, built from the last month of your sessions.", MUTED_P))
    story.append(Spacer(1, 14))
    story.append(hr())
    story.append(Paragraph(
        "You already operate Claude more like a studio than an assistant — long sessions, "
        "parallel agents, git-as-checkpoints. This playbook isn't aspirational: every suggestion "
        "comes from a pattern already visible in your work, sharpened into something you can "
        "apply tomorrow. Skim it. Keep the checklists. Delete the rest.",
        BODY,
    ))
    story.append(Spacer(1, 10))

    # ── 1. Response discipline
    story.append(Paragraph("1 · Keep Claude's outputs small on purpose", H2))
    story.append(Paragraph(
        "Six of your sessions this month hit the output token ceiling mid-task. The fix isn't longer limits, "
        "it's treating long output as a smell. When you need a lot of work done, have Claude write it to files "
        "and report back in one-liners — not stream prose.",
        BODY,
    ))
    story.append(Paragraph("How it shows up", H3))
    story.append(bullets([
        "Giant markdown explanations between tool calls → truncation.",
        "Claude re-explains a plan it just executed → wasted turns.",
        "Mass code dumps in chat instead of edits to files → mid-task cutoff.",
    ]))
    story.append(Paragraph("The rule to add to your CLAUDE.md", H3))
    story.append(code_block(
        "## Response Style\n"
        "- Keep responses concise. Status + diffs, not narrative.\n"
        "- Long work goes into files, not chat. Report one-line summaries.\n"
        "- Split across turns instead of producing one mega-response."
    ))
    story.append(callout(
        "Mini-rule: if your gut says 'this response is going to be long,' have Claude write it to a "
        "markdown file under <i>docs/</i> or <i>renders/docs/</i> and tell you the path."
    ))

    # ── 2. Reading before exploring
    story.append(Paragraph("2 · Force read-first when you cite specific files", H2))
    story.append(Paragraph(
        "The Codex App guide session ended in 'not achieved' because Claude started exploring the codebase "
        "instead of reading the two docs you named. Your prompts are usually clear — this is one of the few "
        "repeat failure modes where a single sentence upfront fixes the class.",
        BODY,
    ))
    story.append(Paragraph("Copy-paste opener", H3))
    story.append(code_block(
        "Before doing anything else: read [file1] and [file2] in full.\n"
        "Give me a 5-bullet summary of each + your proposed plan.\n"
        "Do NOT touch the codebase or run exploration tools until I approve."
    ))
    story.append(Paragraph("Why it works", H3))
    story.append(Paragraph(
        "Claude treats 'explore the codebase' as helpful default behavior. When you explicitly name sources, "
        "you're overriding that default, and the sentence above makes the override unmistakable.",
        BODY,
    ))

    # ── 3. Windows environment
    story.append(Paragraph("3 · Bake Windows quirks into CLAUDE.md once, stop re-hitting them", H2))
    story.append(Paragraph(
        "Your most repetitive friction is environment, not intent: cp1252 encoding crashes, PowerShell "
        "multi-line escaping, servers that don't restart after backend changes. These aren't bugs Claude "
        "can solve — they're context Claude is missing.",
        BODY,
    ))
    story.append(Paragraph("Add this block to any Windows-based project's CLAUDE.md", H3))
    story.append(code_block(
        "## Environment Notes\n"
        "- Platform: Windows 11, bash shell. Use forward slashes in paths,\n"
        "  /dev/null not NUL.\n"
        "- Unicode: cp1252 is the default terminal encoding. Avoid em-dashes\n"
        "  and arrows in print/echo output — use ASCII equivalents or prefix\n"
        "  with PYTHONIOENCODING=utf-8.\n"
        "- PowerShell does not parse multi-line bash heredocs. Use single\n"
        "  lines joined by '&&' or ';'.\n"
        "- After backend (server.js / Python API) changes, restart the dev\n"
        "  server before testing the frontend — stale HTML on a JSON route\n"
        "  is the #1 false-positive bug.\n"
        "- Background processes that read stdin will crash silently. Use\n"
        "  `run_in_background: true` only for commands that don't need input."
    ))

    # ── 4. Git as checkpoint discipline
    story.append(Paragraph("4 · Treat git as the save system — state it once, never again", H2))
    story.append(Paragraph(
        "63 commits across 49 sessions, and multiple of those had to start with 'Claude, this IS a git "
        "repo, please commit.' The fix is a single section near the top of every CLAUDE.md that makes "
        "commit-and-push a baseline behavior.",
        BODY,
    ))
    story.append(Paragraph("Drop this under the project overview", H3))
    story.append(code_block(
        "## Git Workflow\n"
        "- This project is a git repo connected to GitHub.\n"
        "- Always commit and push after completing a meaningful unit of\n"
        "  work unless told otherwise. Use conventional commit messages\n"
        "  (feat/fix/docs/refactor).\n"
        "- Before committing: run `git status` and `git diff --stat`,\n"
        "  then stage specific files (avoid `git add -A`).\n"
        "- Do not skip hooks (--no-verify) and do not amend published commits."
    ))

    # ── 5. Skills
    story.append(Paragraph("5 · Formalize every repeat workflow as a Skill", H2))
    story.append(Paragraph(
        "You already did this with <b>/project-knowledge</b>, <b>builderpack</b>, and the carousel pipeline. "
        "But the workflow that lands you the most 'essential' ratings — the epic-batch kickoff — is still "
        "ad-hoc. Turning it into a slash command stops you from re-typing the same scaffold five times a week.",
        BODY,
    ))
    story.append(Paragraph("Starter skill: /epic-batch", H3))
    story.append(code_block(
        "# .claude/skills/epic-batch/SKILL.md\n"
        "---\n"
        "name: epic-batch\n"
        "description: Execute a sequential run of numbered epics or sessions\n"
        "  with tests, commits, and memory updates between each.\n"
        "---\n"
        "Execute Sessions/Epics $1 through $2 sequentially. For each:\n"
        "  1. Read the session doc.\n"
        "  2. Implement with tests.\n"
        "  3. Run full suite — confirm zero regressions.\n"
        "  4. Commit with 'session-NN: <summary>' and push.\n"
        "  5. Update memory/continuity docs.\n"
        "Do NOT pause between sessions unless a test fails.\n"
        "Keep responses concise — status + diffs only."
    ))
    story.append(Paragraph("Other skills worth formalizing", H3))
    story.append(bullets([
        "<b>/ship</b> — status + diff summary + conventional-message commit + push.",
        "<b>/serve-dashboard</b> — start npm run dev + npm run server together.",
        "<b>/update-memory</b> — write atomic notes + refresh MEMORY.md index.",
        "<b>/preflight-pipeline</b> — validate kie.ai models, clear localStorage, test one asset.",
    ]))

    story.append(PageBreak())

    # ── 6. Hooks
    story.append(Paragraph("6 · Hook the mistakes you keep repeating", H2))
    story.append(Paragraph(
        "You've hit the same Windows server-restart issue 4+ times. You've hit 0x0.st upload 503s "
        "across several pipeline sessions. Hooks turn 'Claude should remember to' into 'the harness "
        "enforces.' Here's a minimal PostToolUse hook that fires after edits to backend files.",
        BODY,
    ))
    story.append(code_block(
        "// .claude/settings.json\n"
        "{\n"
        "  \"hooks\": {\n"
        "    \"PostToolUse\": [\n"
        "      {\n"
        "        \"matcher\": \"Edit|Write\",\n"
        "        \"hooks\": [\n"
        "          {\n"
        "            \"type\": \"command\",\n"
        "            \"command\": \"node -e \\\"const f=process.env.CLAUDE_FILE||''; if (f.endsWith('server.js') || f.includes('/api/')) console.log('Backend changed — restart dev server before testing frontend.')\\\"\"\n"
        "          }\n"
        "        ]\n"
        "      }\n"
        "    ]\n"
        "  }\n"
        "}"
    ))
    story.append(callout(
        "Hooks that reward themselves fastest: UTF-8 encoding check after every Write, "
        "dev-server health ping when server.js changes, and a git-status reminder at session end."
    ))

    # ── 7. Pre-flight checklist
    story.append(Paragraph("7 · Pre-flight every pipeline run in under 60 seconds", H2))
    story.append(Paragraph(
        "Three of your video pipeline sessions were degraded by stale state — expired model names, cached "
        "localStorage, 503'd upload hosts. You already debug all of these one by one when they bite. The "
        "time you lose is one ordering change away.",
        BODY,
    ))
    story.append(Paragraph("Run this checklist at the start of any batch", H3))

    checklist_data = [
        ["#", "Check", "How"],
        ["1", "kie.ai model names current", "curl the kie.ai model list; confirm kling-3.0 / kling-2.6 / nano-banana still live"],
        ["2", "API keys loaded from .env", "server.js dotenv/config in place; keys not expired in Google console"],
        ["3", "Dashboard localStorage clean", "DevTools → Application → Storage → Clear site data"],
        ["4", "One small asset end-to-end", "Generate 1 slide or 1 video, confirm Drive upload succeeds"],
        ["5", "Dev server + API both up", "Ports 5173 and 3001 responding"],
        ["6", "Cloudflared tunnel (if public host needed)", "`cloudflared tunnel` running, URL captured"],
    ]
    tbl = Table(checklist_data, colWidths=[0.3 * inch, 2.2 * inch, 4.1 * inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GOLD),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f7f4ea")]),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor("#cccccc")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10))

    # ── 8. Horizon
    story.append(Paragraph("8 · Where you could push this next", H2))
    story.append(Paragraph("Parallel agent swarms for epic batches", H3))
    story.append(Paragraph(
        "Your Payday Kingdom Epics 2-9 ran sequentially in one session. Fanning them across 5-10 "
        "subagents in isolated git worktrees, with an orchestrator merging + running tests between "
        "each, would compress a week of sequential work into an afternoon. Use the Agent tool with "
        "<code>isolation: \"worktree\"</code>.",
        BODY,
    ))
    story.append(Paragraph("Test-gated autonomous build loops", H3))
    story.append(Paragraph(
        "Write failing spec → implement → regression → commit → next. Your Remotion and kie.ai "
        "pipelines have clean I/O contracts — they're ideal candidates. A <code>backlog.md</code> of "
        "15 specs, consumed one at a time, is a week of unattended work away.",
        BODY,
    ))
    story.append(Paragraph("Obsidian-backed cross-session memory", H3))
    story.append(Paragraph(
        "Extend your /project-knowledge skill into a full SessionStart/SessionEnd hook pair: one distills "
        "every transcript into atomic notes, the other injects the 10 most relevant notes for the "
        "current project at session start. No more re-discovering that 0x0.st 503s.",
        BODY,
    ))

    # ── Closer
    story.append(hr())
    story.append(Paragraph("The short version", H2))
    story.append(bullets([
        "Shorter outputs. Files beat streaming prose.",
        "'Read these files first' is a cheat code.",
        "Windows quirks → CLAUDE.md once, never again.",
        "Git commits are free. State the rule once.",
        "Every repeat workflow → a Skill.",
        "Every repeat mistake → a Hook.",
        "Pre-flight checklist before any batch.",
        "Next level: parallel agents, test-gated loops, background memory.",
    ]))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "Written 2026-04-17 after 51 sessions of data. Not aspirational — this is your own pattern, "
        "played back to you with the rough edges filed off.",
        MUTED_P,
    ))

    doc.build(story)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    build()
