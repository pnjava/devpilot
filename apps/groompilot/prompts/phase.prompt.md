# /phase — Execute current phase tasks

Load:
- `.dev-notes/.project/workflow.md`
- `.dev-notes/.project/context.md`
- The current story folder and the current `phases/PHASE-XX-*.md`

Do:
- Complete the **Tasks** listed in the current phase file.
- Write concrete **Deliverables** back into the same phase file.
- Add/Update ADRs in `decisions.md` if needed.
- Update `context.md` (phase status + last updated).
- Append a sign-off block to `reviews.md`:

  📝 Reviewer: <agent/model>  
  📅 Date: <local timestamp>  
  🧩 Phase: <PHASE-XX>  
  ✅ Verdict: Completed  
  🔗 Commit/Result: <short note or SHA if available>

Output:
- Bullet summary of changes
- File list you updated
- Literal → `Context updated. Review block added.`