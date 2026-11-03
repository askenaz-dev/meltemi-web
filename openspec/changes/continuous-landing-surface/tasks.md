## 1. Shared transition

- [x] 1.1 Remove the hero divider and soften only the drawing's lower edge.
- [x] 1.2 Inspect the six landing pages in both schemes and responsive widths; capture evidence.

## 2. Verification

- [x] 2.1 Run the required build, typecheck, lint and unit tests, plus the existing browser checks.
- [x] 2.2 Record validation and commit the isolated change for review, without pushing or deploying.

Validation on 2026-11-03: build, typecheck and lint passed; `pnpm test --maxWorkers=2`
passed 2191 tests with one skipped. The initial parallel run alongside screenshot rendering
had three timeouts; the complete isolated run passed without changing timeout thresholds.
All nine `pnpm site:browser` checks passed, including no-script rendering, reduced motion,
pause/resume, every moving hero, both schemes and zero layout shift.

Visual review covered Home, IDE and Diagrams in EN/ES, light/dark, at 1280px and 390px
(24 combinations): no divider, no horizontal overflow, contiguous hero/main edges and working
pause controls. Before/after captures are local review artifacts under
`C:/meltemi/artifacts/web-visual-polish/` and are not published assets.
