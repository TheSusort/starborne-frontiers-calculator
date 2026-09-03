# Pre-sweep baseline — clean `origin/main` @ 4abf141c

Run in a throwaway worktree BEFORE the sweep landed, so post-sweep results are a comparison
against a measured state rather than an assumption. Without this, a red post-sweep suite cannot
be attributed to the sweep.

```text
Test Files  637 passed (637)
     Tests  7163 passed (7163)
  Duration  41.01s
  exit code 0
```

Post-sweep MUST match exactly: 637 / 7163 / 0 failures, and **no golden snapshot moved**.
A comment-only change cannot alter any of these numbers. If one moves, the change was not
comment-only — diagnose, do not `vitest -u`.
