---
description: "A rename button was added to TODOs, and additionally"
skip: false
affected:
  include:
    - 001-delete-task-from-column-md
    - 002-move-task-via-dropdown-md
    - 002-delete-last-task-shows-empty-state-md
    - 001-full-task-lifecycle-md
candidates:
  minCount: 1
---

This PR removed the three-dots menu, which will break any test that interacts
with anything inside it. This includes the deletion functionality, so any tests
that cover that should be marked as affected.

Also, it adds "rename" functionality, which should be covered by a new test.
