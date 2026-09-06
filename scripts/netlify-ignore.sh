#!/usr/bin/env bash
#
# Netlify's `ignore` command (wired up in netlify.toml).
#
# EXIT 0 CANCELS the build. Any non-zero exit builds. That inversion is Netlify's,
# not ours, and it is the thing to re-read before editing this file.
#
# Only paths that cannot reach `npm run build` are cancellable:
#   *.md       — no markdown is imported anywhere in src/
#   .github/   — GitHub Actions, a separate runner
#   e2e/       — its own package; the root tsconfig's `include` is ["src"], so
#                `tsc && vite build` never reads it
# `docs/` and `.claude/` are gitignored, so they cannot appear in a diff at all.
#
# Everything else builds, including anything this list does not name. The failure
# modes are not symmetric: a needless build costs ~90 seconds, a wrongly cancelled
# one ships nothing and looks like a successful deploy. So every uncertain case —
# no cached ref, a ref this clone cannot resolve, a failed diff — exits non-zero.

set -uo pipefail

# No previous successful build to compare against (first build, or cleared cache).
[ -n "${CACHED_COMMIT_REF:-}" ] || exit 1
[ -n "${COMMIT_REF:-}" ] || exit 1

# Netlify clones shallowly; either commit may be absent from this working copy.
git cat-file -e "${CACHED_COMMIT_REF}^{commit}" 2>/dev/null || exit 1
git cat-file -e "${COMMIT_REF}^{commit}" 2>/dev/null || exit 1

changed=$(git diff --name-only "$CACHED_COMMIT_REF" "$COMMIT_REF" 2>/dev/null) || exit 1

# An empty diff means a retry of an already-built commit — that is a deliberate
# rebuild request, so honour it.
[ -n "$changed" ] || exit 1

# One path outside the inert set is enough to build.
if printf '%s\n' "$changed" | grep -qvE '(^\.github/|^e2e/|\.md$)'; then
  exit 1
fi

echo "Only documentation, GitHub Actions or e2e files changed — cancelling build."
exit 0
