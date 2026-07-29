# Personal integration and release workflow

This fork keeps personal changes usable as a single Windows build while preserving a clean upstream mirror. Personal work is not proposed to the upstream project.

## Remotes

The local repository intentionally uses these remote names:

- `origin`: `kot149/zmk-battery-center`, the read-only upstream repository.
- `fork`: `kuntashov/zmk-battery-center`, the writable personal fork.

Agents must never push to `origin` or open an upstream pull request unless the user explicitly changes that policy.

## Branch roles

### `main`

`main` mirrors `origin/main`. Do not add personal commits to it.

Update it only with a fast-forward:

```powershell
git fetch origin
git switch main
git merge --ff-only origin/main
git push fork main
```

### `integration/personal-release`

This is the canonical integration and release branch. It contains all personal features and fixes that should be present in the executable used by the fork owner.

Do not develop directly on this branch. Do not force-push or rewrite it. Release tags make already published states immutable.

### Topic branches

Create one topic branch per fix or feature from the current integration branch:

```powershell
git switch integration/personal-release
git pull --ff-only fork integration/personal-release
git switch -c fix/short-description
```

Use `feat/`, `fix/`, `chore/`, or `docs/` prefixes as appropriate. Implement, test, and commit the work on the topic branch.

After verification, publish and integrate it:

```powershell
git push -u fork fix/short-description
git switch integration/personal-release
git merge --no-ff fix/short-description -m "merge: short description"
git push fork integration/personal-release
```

Never merge the integration branch back into `main`.

## Bringing in upstream changes

First fast-forward `main` from `origin/main`. Then merge the updated local `main` into a dedicated sync branch created from the integration branch. Verify the combined application before merging the sync branch into `integration/personal-release`.

```powershell
git switch integration/personal-release
git switch -c chore/sync-upstream
git merge --no-ff main -m "merge: sync upstream main"
```

Resolve and test on the sync branch. Integrate it through the normal topic-branch procedure.

## Required verification

Run these checks before merging a topic branch:

```powershell
bun run lint
bun run test:frontend
bun run test:rust
bun run build:ui
```

For BLE, tray, and other OS integrations, also perform the relevant manual Windows checks with real devices. Record any limitation that CI cannot exercise.

## Personal portable releases

Every push to `integration/personal-release` triggers `.github/workflows/personal-windows-portable-release.yml`.

The workflow:

1. Verifies that the source ref is exactly `integration/personal-release`.
2. Runs lint, the production UI build, frontend tests, and Rust tests.
3. Generates bundled license data.
4. Builds the application with `bun run build:app`, which uses Tauri `--no-bundle`.
5. Creates a unique tag in the form `personal-v<app-version>.<workflow-run-number>`.
6. Publishes a GitHub prerelease containing one custom asset:
   `zmk-battery-center_<app-version>_windows_x64_portable.exe`.

GitHub automatically shows source-code archives for every release. The workflow does not upload MSI, NSIS Setup, screenshots, or checksum files.

Do not overwrite or move an existing personal release tag. To publish another build, merge a new commit into the integration branch. Even a release-only correction must go through a topic branch.

Inspect recent release runs with:

```powershell
gh run list --repo kuntashov/zmk-battery-center --workflow personal-windows-portable-release.yml
```

Download the newest portable executable with:

```powershell
gh release download --repo kuntashov/zmk-battery-center --pattern "*_windows_x64_portable.exe"
```
