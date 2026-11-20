# Zone - AI project handoff

Updated 2026-11-20. Start here before changing code. Product name: **Zone**, capital Z. Repository: https://github.com/Stroymind/My-reader .

## 1. Product intent and current assignment

Zone is a **personal knowledge management system**. Reading is an input capability within it, not the whole product. The user explicitly corrected the earlier reader-only positioning. Preserve the existing knowledge workspace instead of restoring the older bookshelf application.

Current authorized work: prepare a complete AI handoff, rename the product to Zone, and submit updates to GitHub. Earlier requests also asked for a usable Android APK. The next visual direction is a full-width, message-list-like content layout with overlapping cards that expand when tapped. On 2026-11-20 that layout was implemented for the library pane only (full-width rows plus manual named stacks); see section 3.

The user liked a prior Apple-inspired redesign and recalled it as a Grok bot change. Git history attributes the matching implementation to Cursor Agent; preserve the user's design preference without inventing authorship. The matching commit is `4d1011f` ("Turn the reader into an Apple-style reading and knowledge workspace"). Its subsequent fixes end at `0c0b11b` on `cursor/ai-knowledge-workspace-f314`.

The user provided the live site at https://stroymind.github.io/My-reader/ . On 2026-11-20 its HTML matched `0c0b11b:index.html` exactly after normalizing line endings. It still displayed the previous name. This verifies the HTML reference, not every deployed asset or future deployment.

An OpenMotion link was sent by mistake and explicitly withdrawn. It is not a design dependency or part of Zone's scope.

## 2. Critical branch and version facts

Do not combine these states by overwriting files:

| Location / revision | Meaning |
| --- | --- |
| `main` at `07dff1b` when inspected | Older reader plus bilingual reading, list appearance and EPUB fixes; no full knowledge workspace |
| `cursor/ai-knowledge-workspace-f314` at `0c0b11b` | Selected baseline: Apple-inspired knowledge workspace and subsequent fixes |
| `codex/zone-handoff` | Current work branch from that knowledge baseline; Zone branding and this handoff |
| `docs/handoff-20261109` at `20ce9b4` | Earlier handoff, predates the knowledge-workspace implementation |
| `cursor/fix-android-www-modules-15f5` at `9ba5d33` | Separate packaging fix; selected knowledge branch already lists the additional modules in web sync |
| Local sibling `outputs/My-reader/`, based on `f96a69e` | Separate, unmerged reader recovery work; not the current Zone baseline |

The old local reader work includes continuous EPUB/TXT scrolling, font pinch, stronger EPUB validation, parser adapters and reader regression scripts. It was built as My-reader 1.2.0 / Android code 3. These features and their passing historical tests must NOT be described as implemented or passing in the current knowledge branch until ported and retested.

The old branch uses IndexedDB version 1 while the knowledge branch uses version 3. Replacing the current `db.js` with that old file can break installed knowledge databases and remove their APIs. Likewise, replacing `app.js` or `index.html` wholesale would remove notes, graph and assistant integration.

Zone branding release version is 1.3.0 / Android versionCode 4. Check current git/CI/artifact state before claiming a release is uploaded. A local file, a staged change and a successful GitHub push are separate states. Keep the existing GitHub repository name unless the user separately asks to rename it.

The local signed Zone APK was built and verified; see [VERIFICATION.md](VERIFICATION.md) for its exact hash, browser checks and untested areas. This is a knowledge-workspace branding release, not completion of the pending reader integration or overlapping-card layout.

## 3. Confirmed design direction

Confirmed by the user:

- Product: Zone, personal knowledge management.
- Preserve the Apple-inspired direction of the existing knowledge-workspace design.
- Replace the conventional bookshelf feeling with rows like a conversation/message list, spanning available width.
- Allow visually overlapping cards inside a container; tap to expand them.

The user selected "Show overlapping book cards that expand when tapped", then clarified the broader knowledge-system positioning. Start with the library/content-list interaction, but design it to coexist with notes and excerpts. Whether all content types share one feed is undecided. Do not silently replace every workspace pane with a mixed feed.

Recommended prototype behavior (a proposal, not existing functionality):

1. One ordinary item per full-width row, with compact thumbnail/type cue, title, useful metadata and progress when relevant.
2. A collapsed stack shows a readable front card and small offsets for the cards behind it, with a count. Text and touch targets must never overlap.
3. Tap the stack header to expand in place into individual rows. Tapping an expanded item opens it; collapsing is a separate action.
4. Preserve scroll anchor, selection, search/filter state and focus across expansion and returning from an item.
5. Use keyboard-operable buttons, `aria-expanded` and reduced-motion behavior. Do not make hover the only way to access controls.

Implemented on 2026-11-20 (library pane `#pane-shelf` only):

- `#grid.book-list` is a single-column list of full-width rows (cover or monogram, unclipped title, type/author, progress). Long-press delete and the 整理 selection flow still work.
- Grouping is **manual**: select books in 整理, then 放进卡片堆 (new named stack or add to an existing one); 移出卡片堆, per-row 移出, 重命名, 解散 and 收起 never delete books. One book belongs to at most one stack; a stack left with fewer than two books dissolves itself.
- Stacks live in localStorage `rr-stacks` (`{v:1,stacks:[{id,name,bookIds,collapsed,createdAt}]}`) via `stacks.js`. IndexedDB `shufang` v3 and book records are untouched. `deleteBookBundle` removes the deleted id after its transaction; `renderLibrary` also reconciles against live book ids.
- Collapsed/expanded state is saved per stack. While searching, matching stacks open temporarily (only matching members shown); clearing search restores the saved state.
- Notes and excerpts are not mixed into this list. Desktop width is not capped.

Still undecided: automatic grouping, whether notes/excerpts join a shared feed, and a desktop maximum width.

Current Apple-inspired tokens are real source references, not a claim to reproduce Apple's proprietary UI: system font stack; light shell background `#f5f5f7`; dark shell `#000`; accents `#007aff` / `#0a84ff`; translucent cards/toolbars; subtle borders; radius and shadow hierarchy; motion curve `cubic-bezier(.22,.8,.24,1)`. See `app.css` root variables and `.appearance-dark`. Shell light/dark/system appearance is separate from reading paper/white/sepia/night themes; preserve that separation.

Acceptance for the next layout implementation:

- At 390 px width, rows span available width without horizontal overflow or clipped mixed-language titles.
- Collapsed overlaps remain readable; expanded cards have independent hit areas.
- Expand/collapse never accidentally opens/deletes another item or loses the viewport anchor.
- Search can surface items inside collapsed stacks; sorting remains deterministic.
- Existing notes, links, graph navigation, source jumps, AI dialogs and book progress remain usable.
- Light/dark/system appearance and all reading themes still cover long/short screens.
- Verify long lists, empty state, large text, keyboard focus and reduced motion.

## 4. Implemented capabilities on the selected baseline

Source inspection confirms these implementations; do not confuse inspection with exhaustive device testing:

- Book import/read: EPUB, PDF, TXT, HTML and ZIP batches; deduplication and migration manifest support.
- Library search/sort, recent reading, long-press deletion and selection-based management.
- Highlights, annotations, excerpts, copy and bookmarks; return to source passages.
- Independent notes and projected book passages; titles, bodies, tags, concept markers.
- `[[title]]` links, manual links, unlinking and removal of both link directions.
- Knowledge filtering, Markdown outline export and a question/material/judgment template.
- A draggable/zoomable graph with explicit links and shared-tag relationships.
- Optional OpenAI-compatible explanation/question requests and saved AI outputs; local extracted key points when no key is configured.
- Separate application appearance and reading theme; responsive workspace navigation.
- Bilingual page translation and local translation cache.

Not complete according to code/README: full writing/decision workspace, streaming AI output, multiple provider presets, robust semantic concept extraction, cloud sync and graph scaling for large datasets. The overlapping-card list exists for the library pane only (section 3). Continuous cross-chapter scrolling and the older local reader test results require a separate integration pass.

## 5. Architecture map

Vanilla JavaScript ES modules + HTML/CSS, offline PWA, Capacitor 8.6.0 Android wrapper. Vendored epub.js/JSZip and PDF.js. No application backend or account system. Edit root source, not generated `www/` or Android asset copies.

| File / entry point | Responsibility |
| --- | --- |
| `index.html`, `app.css` | Shell, sidebar/mobile navigation, library, notes, graph, dialogs, reader and theme tokens |
| `app.js` | Import/read/library orchestration; selection actions; workspace callbacks; navigation/back handling |
| `workspace.js: initWorkspace`, `showPane`, `refreshWorkspace` | Knowledge UI orchestration; pane routing and refresh |
| `workspace.js: renderNotes`, `openEditor`, `commitEditor` | Note lists, editing and link UI |
| `workspace.js: graphModel`, `renderGraph`, `fitGraph` | Graph model, drawing, selection, pan/zoom |
| `workspace.js: openAssistant`, `dismissAssistant` | AI dialog lifecycle and focus handling |
| `knowledge.js` | Note schema, passage projection, tags/key points, manual/automatic links and deletion |
| `ai.js` | Local provider settings, compatible chat-completions requests, timeout and response handling |
| `bilingual.js` | Visible-page translation via external providers, caching and stale-result checks |
| `engines.js` | EPUB, PDF and text render engines, position/selection/highlights |
| `epub-repair.js` | EPUB archive/path/encoding repair and DRM diagnostics |
| `importer.js` | File/ZIP import, format detection, deduplication, metadata and migration manifests |
| `db.js` | IndexedDB version 3, transaction wrappers and cross-store `run` |
| `settings.js` | Reading settings plus shell appearance |
| `stacks.js` | Manual library stacks in localStorage `rr-stacks`; create/rename/add/remove/dissolve/reconcile |
| `sw.js` | Offline shell version and precached modules |
| `scripts/sync-www.mjs` | Explicit files/directories copied to generated `www/` |
| `scripts/smoke.mjs` | Inherited reader smoke script; environment limitations below |
| `android/` | Native host, identity, signing, version and display name |
| `.github/workflows/android.yml` | APK build on main, PR and manual workflow runs |
| `tweet-to-text/` | Existing independent utility; outside this redesign |

Normal knowledge flow: book selection/highlight -> persisted book passage -> `syncBook` projection -> notes -> links/graph -> editor/source jump or assistant -> saved note. `backfillFromBooks` projects existing highlights at startup. Keep this linkage when touching reader actions or deleting content.

## 6. Persistence contracts

IndexedDB name remains `shufang`, schema version **3**. Stores: `books`, `files`, `meta`, `xlate`, `notes`, `links`. Keys: `books/files/notes/links` use `id`; `meta/xlate` use `key`. Branding must not rename the database or silently clear it.

Notes: `id`, `title`, `body`, `quote`, `tags`, nullable `bookId`/`passageId`, `bookTitle`, `kind`, `concept`, `createdAt`, `updatedAt`. Links: `id`, `fromId`, `toId`, `auto`, `createdAt`. Read current constructors before migration.

- `saveNote` updates timestamp and reconciles automatic title links.
- `linkNotes` deduplicates an existing pair in either direction; `unlinkPair` removes both directions.
- `deleteNote` removes its linked source highlight when applicable and cleans adjacent links.
- `deleteBookBundle` coordinates book-related deletion. Preserve its cross-store transaction instead of separate partial deletes.
- Use `db.update` for concurrent-safe record patches and `db.run` where cross-store transactions are needed.
- Do not overwrite book records to store list-only expansion state. Library stacks and their expansion state live in `rr-stacks` (see section 3).

Local settings: `rr-settings` (reading), `rr-appearance` (light/dark/system), `rr-ai` (provider base URL/model/key), `rr-stacks` (manual library stacks), `rr-sort` (library sort). Inspect other keys in source before changing them. API keys are stored locally in plain localStorage, not encrypted. Never print real user keys in tests, logs, screenshots or commits.

EPUB uses CFI-style locations; PDF uses page positions; text uses its engine-specific chapter/page coordinates. Preserve these contracts for bookmarks, highlights and source navigation. Font/mode changes require passage-preservation tests, not just screenshots.

## 7. Network and privacy facts

Books and knowledge records are stored on-device. Two different outbound paths exist:

1. `ai.js` sends user-triggered explanation/question context to the configured base URL plus `/chat/completions`, with a key and a 25-second timeout. No-key mode uses local extracted points. Sending note context differs from sending only selected text.
2. `bilingual.js` sends visible English paragraphs to MyMemory, falling back to Google translation, when bilingual reading is enabled; no AI key is required. It caches translations in `xlate`.

Do not promise "nothing leaves the device" or "only AI-key actions send text". The inherited README's privacy statement was corrected during this handoff. Tests should block/mock external requests and use synthetic content unless an actual external call is explicitly part of the test. Do not upload the user's supplied EPUB to git, a model provider or test artifacts.

## 8. Build and verification

Use Node 22 (CI), npm, Java 21, Android SDK 36. Browser work requires HTTP rather than `file://`.

```
npm ci
python -m http.server 8000
```

Open `http://localhost:8000`. Offline caches may hide edits; use a test profile and inspect service-worker state rather than clearing a user's IndexedDB. The source has `window.__app` for smoke automation; use exported knowledge APIs for isolated data-contract checks.

Android on Windows:

```
npm run cap:sync
cd android
.\gradlew.bat assembleRelease --no-daemon
```

Linux/macOS: `./gradlew`. APK output: `android/app/build/outputs/apk/release/app-release.apk`.

Identity remains `io.github.stroymind.myreader`, minimum API 24. Preserve the existing sideload signing certificate to allow upgrades retaining data. The repository key is public and is not a private app-store signing identity. Verify version, label, signature, non-debuggable flag and packaged assets before delivery.

`scripts/sync-www.mjs` includes `bilingual.js`, `epub-repair.js`, `knowledge.js`, `ai.js`, `workspace.js`, `stacks.js` (also precached by `sw.js`, cache `zone-1.3.0-list1`). Keep both sync and service-worker lists current when adding modules. Missing modules can produce an APK that installs but opens blank.

CI uploads `zone-android` containing `zone.apk`. The release job checks for tags, but the inherited workflow does not declare tag push triggers. Do not claim a main push automatically creates a GitHub Release.

Inherited test limitation: `npm run test:smoke` uses Linux Chrome/Python assumptions and `/opt/cursor/artifacts` screenshots and predates parts of the workspace UI. It is not a complete Zone acceptance suite. There is no `npm test` script on the knowledge baseline. Port affected checks deliberately; do not copy the older reader suite and claim coverage of notes/graph/AI.

This handoff adds `npm run test:zone` using `scripts/zone-smoke.mjs` and `scripts/browser-support.mjs`. It discovers a local Chrome/Edge executable (or `CHROME_PATH`), serves an isolated local origin and blocks external requests. Run it after `npm ci`; it writes ignored `test-results/zone-verification.json` and a screenshot. It passed on Windows / Chrome 157.0.8103.79: startup branding, note/tag reload, automatic links, pair deduplication/unlink/deletion, list/graph rendering, AI settings closure, no horizontal overflow at 390/1100 px and offline shell reload. No live model call or physical Android interaction was tested.

On 2026-11-20 `test:zone` was extended (16 checks, passed on Windows / Chrome 157.0.8103.79, zero page errors, zero external requests) with synthetic books: full-width single-column rows with unclipped mixed-language titles; creating a named stack through 整理; collapsed `aria-expanded=false` with non-colliding front card and offset layers; tap to expand in place (`aria-expanded=true`) with independent row hit areas, kept focus and header anchor; rename, per-row 移出, 收起; search showing a member of a collapsed stack without changing its saved state; opening a TXT from an expanded stack and returning with search/expansion/focus kept; deletion via 整理 and `deleteBookBundle` cleaning stack membership; ungroup keeping books; no horizontal overflow at 390/1100 px in both states. Not tested: real EPUB covers, very long lists, large system text, screen readers, physical Android gestures and APK rebuild.

Required verification for future changes:

- Notes: create/edit/reload, tags, manual links, title links, unlink both directions, deleting a source note and deleting a book bundle.
- UI: all panes at mobile/desktop widths, graph selection, editor save/cancel, AI dialog dismissal/back/focus and empty states.
- Reader: real EPUB import/open, forward/backward navigation, fonts, excerpt/source jump and reopen progress.
- Release: asset graph completeness, cold start/offline start, retained data after upgrade and actual Android hardware gestures.
- New list: expand/collapse, search hidden members, anchor preservation and keyboard accessibility.

Record results by branch/commit, environment and fixture. Physical device behavior, live AI-provider responses and broad EPUB compatibility cannot be inferred from a branded title check.

## 9. Integrating the separate reader recovery work

The sibling old checkout contains useful work but is not ready for a wholesale merge into Zone. Its `AUDIT.md` / `TEST_RESULTS.md` and 1.2.0 APK describe that separate baseline. Latest attempted rerun during this handoff encountered a browser sandbox connection issue, then a smoke timeout at line 268 on retry; historical pass records should not be described as a fresh passing run.

Recommended integration order:

1. Preserve knowledge schema v3, all workspace callbacks, bilingual preferences and native changes.
2. Port parser validation/encoding repair behind the existing import flow; compare the two EPUB repair strategies and keep one consistent validation/render interpretation.
3. Port continuous EPUB/TXT scrolling and stable anchors without removing knowledge selection/source hooks.
4. Port pinch reflow and layout sanitation; test selection, bilingual pane and source-position restoration together.
5. Add text workers/cache/adapters with explicit compatibility and packaging checks.
6. Run both reader and knowledge tests, then validate actual supplied EPUB and Android upgrade behavior.

Historical sample evidence in the old branch: 65 EPUB spine entries, 217,701 non-whitespace characters, recovered extensionless `EPUB/xhtml/cop1_1`. Those numbers are not a Zone benchmark. The supplied copyrighted book is a local attachment, not a distributable fixture.

## 10. Local handoff locations and startup prompt

Outer workspace: `C:/Users/cao17/Documents/Codex/2026-11-06/https-github-com-stroymind-my-reader`.

- Current Zone worktree: `outputs/Zone/`.
- Preserved older reader checkout: `outputs/My-reader/`.
- Local APK/evidence deliveries: `outputs/`.
- Local SDK/JDK/build helpers: `work/`; not required for a clean clone with a normal toolchain.
- User's EPUB: outside git in a WeChat attachment folder. Obtain an authorized local test copy if needed.

Do not remove either checkout or reset the old staged work to make status look clean. For a new machine, clone the correct branch and use repository build commands; these absolute paths are local conveniences only.

Next AI startup:

1. Read this file and current README; inspect `git status`, branch, HEAD and remote before editing.
2. Verify the knowledge baseline and latest review fixes remain present.
3. Read only the relevant modules for the next task; establish affected tests.
4. Build the expandable-list prototype without removing existing knowledge workflows; resolve grouping before persistence.
5. Treat reader-fix integration as separate work with its own acceptance evidence.
6. Update this handoff and actual test/build results, then deliver the requested source/APK with truthful status.

Copyable starter prompt:

> Continue Zone, a personal knowledge management system, from HANDOFF.md. Use the Apple-inspired knowledge-workspace baseline, not the old reader-only checkout. Preserve notes, links, graph, assistant, storage identity and reading/source navigation. The next UI direction is full-width message-list-style rows with overlapping cards that expand on tap; grouping rules are still undecided. Inspect git state and existing code first, implement a narrow reversible change, verify affected data/UI behavior, and report actual build/test evidence. Do not confuse the separate 1.2.0 reader fixes with integrated Zone functionality.
