# zmk-battery-center
This is a system tray app to monitor the battery level of ZMK-based keyboards, built with Tauri v2.

# Rules
- Use `bun` as JavaScript package manager. Do not use `npm` / `npx`, `yarn`, or other package managers.
- Write UI text and comments in English.

# Personal fork workflow
- Treat `origin` (`kot149/zmk-battery-center`) as read-only upstream. Never push to it or open upstream pull requests unless the user explicitly changes this policy.
- Push personal branches only to `fork` (`kuntashov/zmk-battery-center`).
- Keep `main` as a fast-forward mirror of `origin/main`; do not commit personal changes directly to `main`.
- `integration/personal-release` is the canonical branch containing all personal changes and the only source for personal Windows releases.
- Start each fix or feature in a topic branch created from `integration/personal-release`. Verify and commit it there, then merge it into the integration branch with `--no-ff`.
- Do not develop directly on `integration/personal-release`, rewrite it, force-push it, or reuse/overwrite personal release tags.
- A push to `integration/personal-release` runs `.github/workflows/personal-windows-portable-release.yml`. The workflow must publish only the portable Windows executable as a custom release asset; never add installers unless the user explicitly requests them.
- Read `docs/PERSONAL_RELEASE_WORKFLOW.md` before changing branches, remotes, release automation, tags, or versions.
