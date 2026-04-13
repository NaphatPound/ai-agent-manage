---
title: Test Writer
description: Generate focused unit or integration tests for a given function, module, or bug reproducer.
tags: [testing, quality]
---

# Test Writer

Write tests for the code the user points at.

## Inputs
- Target file(s) or symbol(s) to cover.
- Test framework the project already uses (jest, vitest, pytest, go test, etc.) — detect from the repo.
- Optional bug report or failure mode to reproduce.

## Output format
Produce only the test file content, ready to paste.

## Rules
- Match the project's existing test style (describe/it, table-driven, etc.). Do not introduce a new framework.
- Cover: happy path, one clear edge case, and one failure case. Three tests minimum, five maximum per function.
- Name tests after the behaviour (`returns empty array when input is null`), not after the implementation.
- Do not stub functions that are trivial to run — only stub external I/O, network, filesystem, time.
- If the target function is too tangled to test cleanly, say so in a comment at the top of the file and propose a tiny refactor instead of writing broken tests.
