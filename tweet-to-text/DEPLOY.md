# Deploy handoff

## Preferred (new repo)
1. User creates empty **public** GitHub repo: `Stroymind/tweet-to-text` (no README/license/.gitignore so first push is clean).
2. CloudAgent on `https://github.com/Stroymind/tweet-to-text`:
   - Copy all files from the attached `tweet-to-text/` (or unpack `tweet-to-text.tar.gz`) to repo root.
   - Commit to `main`, push.
   - Ensure GitHub Pages uses **GitHub Actions** (workflow `.github/workflows/pages.yml` is included).
   - Confirm live URL: `https://stroymind.github.io/tweet-to-text/`
3. Success checks: open live URL; `/manifest.webmanifest` has `share_target`; paste a public tweet link and get Chinese translation.

## Fallback (no new repo)
Add this app under existing `Stroymind/My-reader` as folder `tweet-to-text/` so it serves at
`https://stroymind.github.io/My-reader/tweet-to-text/`. Relative paths already use `./` so it works in a subfolder.

## Do not
- Hard-code any API keys
- Change Drive sharing
- Post anything to X
