# Zone 1.3.0 verification

Date: 2026-11-20. Baseline: knowledge-workspace commit `0c0b11bcfab8691fb80476435484170a4414bc9a`, with Zone branding and handoff changes on `codex/zone-handoff`.

## Completed

- `npm ci --offline`: installed the locked dependencies from the local cache.
- JavaScript syntax checks: passed for application modules and scripts.
- `git diff --check`: passed.
- `npm run test:zone`: passed using Windows / Chrome 157.0.8103.79 in a fresh profile. This covers mobile startup/title, persisted notes/tags, automatic title links, manual-link deduplication, pair unlinking, deletion cleanup, knowledge list and graph rendering, AI settings opening/closing, mobile/desktop overflow and offline reload. No page errors or outbound external requests occurred.
- Visually inspected the settled mobile knowledge-list screenshot.
- `npm run cap:sync` and Gradle `assembleRelease --offline --no-daemon`: passed using Java 21 and Android SDK 36.
- APK v2 signature verified against the previous release certificate. Package is non-debuggable, label is Zone, application ID is unchanged, version is 1.3.0 / code 4, minimum API is 24.
- All 210 packaged web assets match the synced build; source-backed assets also match root source. Knowledge, workspace, AI, bilingual and EPUB repair modules are present.

## Local APK

- Filename: `Zone-1.3.0.apk`
- Size: 13,454,436 bytes
- SHA-256: `ef72c2fd8ddf116b30d7042e39214e4a81817f0a0753b2f67eab1c4abb2d3b96`
- Signing certificate SHA-256: `9b0d101fbf5e4c5d55c98c6fa39595c3539edf29e5b49523116db572f985faad`

The APK and detailed verification JSON are local deliveries outside git. A CI rebuild may have a different APK hash. Use the hash belonging to the actual downloaded artifact.

## Limits

The expandable overlapping-card design is documented but not implemented. Reader fixes from the separate old local checkout are not integrated. This run did not verify physical Android gestures/data upgrade, iOS, a broad real-book corpus, live AI providers or translation services. It did not run the inherited Linux-specific reader smoke script as a Zone acceptance suite. Browser knowledge checks and successful packaging do not prove every reader regression is fixed.

The public site's HTML matched the selected knowledge baseline before this update. That comparison is not evidence that a new deployment has occurred.

## Reproduce browser checks

Install Node 22 and Chrome/Chromium/Edge; set `CHROME_PATH` if needed. From repository root:

```
npm ci
npm run test:zone
```

Generated JSON and screenshot go to ignored `test-results/`. The browser server uses a temporary port and a fresh profile. See HANDOFF.md for build instructions and separate pending reader integration.
