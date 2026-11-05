# Tasks

## 1. Persistent owner control

- [x] 1.1 Add persistent state to both stores with schema and SQL conformance tests.
- [x] 1.2 Add owner-only EN/ES administration, live-session/Origin/CSRF guards and account link.
- [x] 1.3 Expose the no-store boolean read and test missing/failed reads.

## 2. Enforce the stop

- [x] 2.1 Add strict fail-closed control reads and enforce before each runtime AI operation.
- [x] 2.2 Guard each build embedding batch and retain usable cached current passages while off.
- [x] 2.3 Add distinct paused/unavailable dialog states, retry on reopening, and preserve search.
- [x] 2.4 Bind Docs to identity in production and preserve fully offline development.

## 3. Verify and deliver

- [x] 3.1 Document EN/ES operation, in-flight limitations, cache behavior and free-plan scope.
- [x] 3.2 Run typecheck, lint, build, unit tests and browser checks for both languages/states.
- [x] 3.3 Review security and deployment wiring, validate OpenSpec, prepare reviewable PR.
