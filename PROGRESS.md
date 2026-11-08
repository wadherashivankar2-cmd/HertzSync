# Progress Log

> [!NOTE]
> Project renamed from TrickleSettle to HertzSync on November 8, 2026.

- Phase 0: Setup and guardrails - COMPLETE (genesis hash verified in Phase 3)
- Phase 1: Database and shared state foundation - COMPLETE
- Phase 2: Ingest API and security - COMPLETE
- Phase 3: Solana integration and RPC router - COMPLETE
- Phase 4: Settlement worker, recovery, and shutdown - COMPLETE
- Phase 5: Device simulator - COMPLETE
- Phase 6: Operator console (dashboard) - COMPLETE
- Phase 7: Metrics and observability - COMPLETE
- Phase 8: Full test and security hardening - COMPLETE
- Phase 9: Documentation and demo - COMPLETE
- Phase 10: Final Definition of Done - IN REVIEW (Audited items 1-19, Section 12.2 report generated)

### Phase 0–4 Changes:
- **`tests/integration/worker-shutdown.test.ts`**: Increased child-process startup event listener wait timeouts (`setTimeout(() => resolve(), ...)`) from 3000ms to 8000ms. Under full parallel Vitest test execution (36 test suites running concurrently across all CPU threads on Windows), spawning a separate Node process running `vite-node` to compile and boot the worker script can take slightly longer than 3.0s (~3.2s) before emitting `"Worker ready"` or `"Resuming"`. Increasing the event wait timeout to 8000ms prevents premature resolution while remaining well within the file's 15000ms test budget. All S20 assertions (SIGINT finishes current step, exits with code 0, persists submitted batch in SQLite, resumes unconfirmed batch on restart, and exits with code 1 on second signal) remain 100% identical and unchanged.

### Definition of Done Audit Highlights (Items 1, 8, 12):
- **Item 1 (Simulator and Rate Limit)**: Simulator generated more than 1,000 events across 10 devices (exceeding the base requirement of 500 events across 3 devices), with zero drops. The 1,000-event burst test ran in a dedicated test environment with an elevated RATE_LIMIT_PER_MIN; the default production limit remains 600 requests per minute.
- **Item 8 (Security Audit)**: 0 critical; 1 high is an approved, documented exception (PostCSS build tooling within Next.js); 5 moderate in pinned @solana/web3.js 1.x dependencies. All documented with feature-usage analysis in SECURITY.md.
- **Item 12 (Clean-Clone Benchmark)**: Clean clone completed in about 2 minutes on the test machine (automated agent benchmark; human manual setup estimated at 5-10 minutes).

---

## Theme upgrade and 404 upgrade (visual only)

- **Status**: COMPLETE
- **Theme Palette & Colour Roles**:
  - **Dark (default)**: Role 1 base `#0A0F1F`, Role 2 matching fade `#1B2A6B` @ 35% opacity (bottom 28% of viewport), Role 3 warm accent `#FF8A4C` (minimal glow <= 15% opacity under 24px from buttons, focus rings, and active-state dot), Primary text `#F1F5F9`, Muted text `#94A3B8`.
  - **Light**: Role 1 base `#F4F6FB`, Role 2 fade `#C9D3F5` @ 40% opacity, Role 3 accent `#C2410C`, Primary text `#0F172A`, Muted text `#475569`.
  - **Surfaces**: Solid `#131B35` (dark) and solid `#FFFFFF` (light) so numbers and labels stay on solid colour.
- **Metrics & Motion**:
  - Stat cards display large tabular figures (`font-variant-numeric: tabular-nums`), small uppercase label above, delta/reconciled line below.
  - SVG sparkline in each card drawn strictly from real SQLite metrics and confirmed batch histories (no random or simulated data).
  - Short ease-out count animation for numeric changes; 200ms theme color transition across surfaces; button hover lift with Role 3 focus rings; interactive targets >= 44px. All motion/transitions cleanly disabled under `prefers-reduced-motion: reduce`.
- **Theme Switcher**: Header button group with two labeled options ("Dark" and "Light"), keyboard accessible with `aria-pressed`, persisted in `localStorage` with inline head script preventing flash of wrong theme before first paint.
- **Upgraded 404 Page (`src/app/not-found.tsx`)**:
  - Full-screen Role 1 base with Role 2 bottom fade.
  - Large aria-hidden "404" numeral with subtle accent gradient behind single `<h1>This page isn't in the ledger.</h1>`.
  - Headline explanation sentence, static SVG flatline labeled "No events here.", primary button "Back to dashboard" (`/`), and secondary button "Check the README" (repo link).
  - HTTP 404 status preserved on unknown routes.
- **Verification Summary**:
  - **WCAG Contrast Ratios**: 100% PASS across both Dark and Light modes (Primary text >= 15.5:1, Muted text >= 6.6:1, Button on accent >= 5.1:1, Focus ring >= 4.7:1, Status badges >= 7.0:1, 404 headline >= 16.5:1).
  - **Axe-core Violations**: 0 across all severities (critical: 0, serious: 0, moderate: 0, minor: 0) on Dashboard (Dark & Light) and 404 Page (Dark & Light).
  - **HTTP Status Code**: `curl -i http://localhost:3000/does-not-exist` confirmed `HTTP/1.1 404 Not Found`.
  - **Reduced Motion**: Verified via CDP (`transition-duration: 0.00001s`, `animation: none`).
  - **Test Suite**: 36 test files passed, 113 tests passed (`MAX_LIVE_TRANSFERS_PER_TEST_RUN=0`).
  - **Production Build**: `next build` compiled cleanly with static `/_not-found` generation.
