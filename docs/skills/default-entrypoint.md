# Default Skill Entrypoint

## What “quickstart as the default recommended entrypoint” means

It does **not** mean removing the operator skill.

It means:

- new users should start with `$jshook-reverse-quickstart`
- advanced users or escalated tasks should move to `$jshook-reverse-operator`
- README and setup docs should present quickstart first
- quickstart should be the lowest-friction path for common tasks

## Practical product behavior

### Quickstart should be used for

- open a site and see what matters
- trace a request
- find likely signing logic
- generate a workflow hook
- resume and summarize a session

### Operator should be used for

- direct debugger control
- breakpoint/watch/XHR/event/blackbox work
- manual hook lifecycle control
- deeper evidence-driven reverse reports

## Why this split matters

Without the split, users either:

- start with too many expert tools and pay the context cost immediately, or
- never discover the expert surface when they really need it

The recommended product path becomes:

1. Start with quickstart
2. Escalate to operator when workflow tools are not enough

## Repo implications

To keep quickstart as the recommended default:

- README should mention quickstart first
- skill validation should cover both skills
- quickstart docs should stay workflow-first
- operator docs should stay expert-first
