# Documentation AI control verification — 2026-11-05

The change `docs-ai-control` adds a persistent owner control without changing the account's
Cloudflare plan or the answering model. Production remains active; this report records local
verification, not a deployment.

## Validation

- `pnpm typecheck`, `pnpm lint` and `pnpm build` passed.
- Full `pnpm test`: 2,377 passed, one skipped, 58 test files. An initial run found the deployment
  test's expected secret binding count needed to include the existing `ADMIN_SUBS` binding;
  the corrected run passed.
- `pnpm docs:browser`: all 12 checks passed, including English/Spanish pause, search fallback,
  re-enable, unavailable control, races, dark/light, mobile and no JavaScript.
- Four cross-package tests use the real identity handler and signed owner forms with the Docs
  worker: warmed-isolate pause prevents AI, re-enable restores it, revoked sessions cannot change
  state and control failures block AI. Guides and Pagefind bypass the control dependency.
- SQLite conformance, schema replay and a failed-write trigger prove persistence and failure
  handling without a cloud account. Disabled/invalid control tests assert zero new AI calls.
- Wrangler dry-run produced the Docs bundle with `IDENTITY`, `AI`, `ASK_LIMIT` and `ASSETS`.
- Actual EN/ES owner pages were inspected with real handlers/CSS and generated local fixture
  sessions. Pausing in Spanish persisted into the English view; enabling restored the saved state.

## Cheaper model review

Cloudflare's current price list offers Granite 4.0 H Micro at USD 0.017 per million input tokens
and 0.112 per million output tokens. GLM-4.7-Flash is approximately 0.0605/0.400 respectively.
For 4,000 input plus 400 output tokens, the listed generation-price equivalent is approximately
USD 0.113 versus 0.402 per thousand questions, before the free allowance (about 72% lower).
This is a pricing comparison, not a measured bill or a guarantee of identical tokenization.

The bounded REST evaluation was rejected with HTTP 401 before generating an answer; no token
permissions were expanded. A public Cloudflare playground smoke test with Granite found that the
first Spanish question returned relevant facts in English without citations. A simplified explicit
Spanish prompt produced a useful cited answer. A later English response used incorrect source
numbers in a conversation containing earlier passages, so it is not an isolated benchmark.

These checks do not establish adequate replacement quality. The implementation keeps GLM,
thinking disabled and a 400-token completion limit. It adds no automatic retry with a more
expensive model and no model calls to the offline test suite. Before switching, run isolated
EN/ES grounding, citation and abstention cases through the same API and prompt as production.

Sources checked:

- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Granite 4.0 H Micro model](https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/)
- [IBM's model card](https://huggingface.co/ibm-granite/granite-4.0-h-micro)

## Delivery boundary

Use the existing CI-approved-main deployment: apply identity's schema, deploy identity with the
existing owner allowlist binding, then deploy Docs with its service binding. Keep the saved switch
enabled. No dashboard configuration, paid upgrade or production data change was made by this work.
