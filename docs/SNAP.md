# OpenHamClock Snap Package

OpenHamClock can be packaged and distributed as a strictly-confined **Snap** package for Ubuntu, Debian, Arch Linux, Fedora, Manjaro, openSUSE, and any Linux distribution with `snapd` enabled.

---

## Building Locally

### Prerequisites

- `snapd` and `snapcraft` installed:
  ```bash
  sudo snap install snapcraft --classic
  ```

### Build Command

```bash
# Using LXD / Multipass container (recommended):
snapcraft

# Or building directly in the current environment:
./scripts/build-snap.sh
```

This generates `openhamclock_<version>_<arch>.snap` (e.g. `openhamclock_26.7.2_amd64.snap`).

---

## Installing & Testing Local Snap

```bash
sudo snap install --dangerous openhamclock_*.snap
```

---

## Usage

### 1. Launch Interactive / Desktop App

```bash
openhamclock --browser
```

### 2. Run as Background Daemon

```bash
sudo snap start openhamclock.daemon
sudo snap stop openhamclock.daemon
sudo snap restart openhamclock.daemon
sudo snap logs -f openhamclock.daemon
```

---

## Publishing to the Snap Store

1. Log into your Ubuntu / Canonical Snap Store account:
   ```bash
   snapcraft login
   ```
2. Register the snap name (first time only):
   ```bash
   snapcraft register openhamclock
   ```
3. Upload and release the snap:
   ```bash
   snapcraft upload --release=stable openhamclock_*.snap
   ```
