# /newstory — Create a new story scaffold

Inputs (ask or deduce from chat):
- Story ID (e.g., STORY-1234)
- Short title (kebab-case recommended)
- Brief problem statement
- Acceptance criteria (bullet points)

Create:
- `stories/<ID>-<short-title>/`
    - `story.md` (user story + acceptance criteria)
    - `plan.md` (phases outline)
    - `facts.md` (empty “verified facts only”)
    - `decisions.md` (ADR header)
    - `phases/PHASE-01-discovery.md`
    - `phases/PHASE-02-arch-mapping.md`
    - `phases/PHASE-03-implementation.md`
    - `phases/PHASE-04-qa.md`
    - `reviews.md`

Update:
- `.dev-notes/.project/context.md` → set Current Story and Phase to PHASE-01

Output:
- Path to the story folder
- Next step: “Run /phase to begin Discovery.”
- Literal → `Context updated.`