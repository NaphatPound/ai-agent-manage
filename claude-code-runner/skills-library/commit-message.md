---
title: Conventional Commit Writer
description: Turn a staged diff into a clean, conventional-style commit message with a punchy first line and optional body.
tags: [git, commit, workflow]
---

# Conventional Commit Writer

Generate a commit message from the currently staged changes.

## Inputs
- `git diff --cached` output.
- The repository's recent commit history for style hints.

## Output format
Respond with only the commit message, no fences, no prose before or after:

```
<type>(<scope>): <short imperative summary>

<optional body paragraph explaining the "why", wrapped at ~72 chars>
```

## Rules
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`.
- First line under 72 characters, imperative mood, no trailing period.
- Scope in parentheses is optional — include it only when it adds clarity.
- Explain the *why* in the body, never the *what* (the diff is the what).
- If the change is trivial, omit the body entirely.
- Never invent issue numbers, co-authors, or sign-offs that aren't in the diff or history.
