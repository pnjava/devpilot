# /workflow — Start or continue structured work

You are operating in a stateless, file-driven workflow. You may use chat memory for helpful context, but the authoritative truth
ALWAYS comes from the project files.

## Load first (in this order)
1) `.dev-notes/.project/workflow.md`  ← authoritative agent rules
2) `.dev-notes/.project/context.md`   ← current story/phase/status
3) The current story folder shown in `context.md` (path starts with `stories/`)

## Behavior (mandatory)
- Follow the rules in `workflow.md`.
- Execute ONLY the tasks for the **Current Phase**.
- Update the correct files as you work:
    - `context.md` → Current Phase, status, last updated, ADR index
    - `stories/<ID>/*/phases/PHASE-XX-*.md` → fill Tasks & Deliverables
    - `stories/<ID>/*/facts.md` → only verified facts (no speculation)
    - `stories/<ID>/*/decisions.md` → add ADRs; never overwrite, only append/supersede
    - `stories/<ID>/*/reviews.md` → add a timestamped sign-off block

## Output format
1) **Summary**: what you did this run (bullets, concise)
2) **File updates**: list of files you changed with brief changes
3) **Next step**: one-sentence next action (which phase/file)
4) **Confirmation**: the literal string → `Context updated. Review block added.` (if applicable)

## Anchors
- When referencing code, ALWAYS use `(file::line)` anchors.

## Guardrails
- If something is missing/ambiguous, write a note in the current phase file under **Risks/Notes** and proceed with what’s possible. Do not stall.

Begin now by applying this to the **Current Phase** indicated in `context.md`.