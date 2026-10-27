# OpenHamClock Packaging & Automated Release Guide

OpenHamClock is distributed through multiple package managers:

- **Arch User Repository (AUR)**: [`openhamclock-git`](https://aur.archlinux.org/packages/openhamclock-git)
- **Canonical Snap Store**: [`openhamclock`](https://snapcraft.io/openhamclock)

---

## 1. Automated Sync Architecture

Whenever you synchronize with the upstream repository (`accius/openhamclock`), both package channels can be updated automatically through local commands or GitHub Actions CI/CD workflows.

```
Upstream (accius/openhamclock:Staging)
             │
             ▼
Local / GitHub (9M2PJU/openhamclock:Staging)
     ├──► AUR Package (openhamclock-git)
     │       └── pkgver & .SRCINFO auto-regenerated -> aur.archlinux.org
     └──► Snap Store (openhamclock)
             └── Multi-arch build & release -> snapcraft.io/openhamclock
```

---

## 2. Local One-Command Sync & Update

To synchronize the latest changes from upstream and update AUR and Snap packages locally:

```bash
# Sync upstream and update AUR pkgver/.SRCINFO locally
npm run sync:upstream

# Sync upstream and automatically push to GitHub + AUR
npm run sync:upstream -- --push

# Sync upstream, push, and build/upload Snap package
npm run sync:upstream -- --push --upload-snap
```

### Dedicated Sub-commands:

- **Update AUR only**: `npm run update:aur -- --push`
- **Build Snap locally**: `npm run build:snap`

---

## 3. GitHub Actions CI/CD Automation

The repository includes three automated workflows in `.github/workflows/`:

| Workflow          | File                | Trigger                              | Description                                               |
| :---------------- | :------------------ | :----------------------------------- | :-------------------------------------------------------- |
| **Sync Upstream** | `sync-upstream.yml` | Daily schedule (00:00 UTC) / Manual  | Fetches `upstream/Staging` and pushes to `origin/Staging` |
| **Update AUR**    | `update-aur.yml`    | Push to `Staging`, tags `v*`, Manual | Updates `PKGBUILD` and `.SRCINFO`, pushes to AUR          |
| **Publish Snap**  | `publish-snap.yml`  | Push to `Staging`, tags `v*`, Manual | Builds and publishes Snap to `stable` or `edge`           |

### Required GitHub Repository Secrets (for CI/CD):

1. **`AUR_SSH_PRIVATE_KEY`**:
   - Your SSH private key authorized on `aur.archlinux.org` (e.g. `~/.ssh/id_ed25519` or `~/.ssh/aur`).
2. **`SNAPCRAFT_STORE_CREDENTIALS`**:
   - Exported Snapcraft store token:
     ```bash
     snapcraft export-login --snaps=openhamclock snapcraft.login
     # Paste content of snapcraft.login into GitHub Secrets
     ```

---

## 4. How Versioning Works

- **AUR (`openhamclock-git`)**:
  - As a VCS package, `pkgver()` evaluates `git describe --long --tags --always` at installation time. Any user installing or upgrading via `yay -S openhamclock-git` always pulls the latest commit.
  - The script `scripts/update-aur.sh` ensures the web interface on `aur.archlinux.org` always reflects the exact latest release version.
- **Snapcraft (`openhamclock`)**:
  - Uses `adopt-info: openhamclock` in `snap/snapcraft.yaml` with `craftctl set version`.
  - Snapcraft reads `version` dynamically from `package.json` at build time without needing manual file edits.
