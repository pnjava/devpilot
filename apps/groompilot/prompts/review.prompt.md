# /review — Add a review/sign-off for the current phase

Load:
- `.dev-notes/.project/context.md`
- Current story’s `phases/PHASE-XX-*.md`
- Current story’s `reviews.md`

Do:
- Evaluate whether the phase **Deliverables** meet the checklist.
- If gaps exist, list them under “Changes requested” in the phase file.
- Otherwise, add the review block to `reviews.md`:

  📝 Reviewer: <agent/model>  
  📅 Date: <local timestamp>  
  🧩 Phase: <PHASE-XX>  
  ✅ Verdict: Approved | Changes requested  
  🔗 Commit/Result: <short SHA or note>

- Update `context.md` only if phase status changes.

Output:
- Verdict + reasons (bullets)
- Files updated
- Literal → `Review recorded.`