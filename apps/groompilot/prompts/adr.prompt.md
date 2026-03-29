# /adr — Append an Architectural Decision Record

Load:
- `.dev-notes/.project/context.md` (to find current story path)
- `stories/<ID>/decisions.md`

Do:
- Append a new ADR in this format:

## ADR-<N>: <Title>
- Date: <YYYY-MM-DD local>
- Decision:
- Rationale:
- Alternatives:
- Impact:
- Status: Proposed | Approved | Superseded

Rules:
- Increment `ADR-<N>` sequentially.
- Never rewrite old ADRs; supersede with a new one if needed.

Output:
- ADR number + title
- Literal → `ADR recorded.`