# OpenHamClock Rig Control - External Test Plan

**Version:** 1.0
**Feature:** Rig Control Minimal Integration
**Branch:** `feat/rig-control-minimal`

## 1. Introduction
This document outlines the test procedures for verifying the new Rig Control integration in OpenHamClock. The goal is to ensure that the application can communicate with an amateur radio transceiver via the intermediate daemon, correctly display frequency/mode, and control the rig (tuning and PTT) from various panels.

## 2. Prerequisites

### Hardware
- A computer running OpenHamClock (local dev or deployed).
- An amateur radio transceiver (Rig) with CAT control capabilities.
- A USB CAT cable connecting the computer to the Rig.

### Software
- **Node.js** (v16 or higher) installed on the machine connected to the Rig.
- **Hamlib (`rigctld`)** OR **`flrig`** installed and configured for your specific radio.
    - *Note: `rigctld` is part of the `hamlib` package.*
    - *Note: `flrig` is a standalone GUI program.*

## 3. Setup & Installation

### Step 3.1: Start the Rig Interface (Backend)
1. **Connect your Rig** and ensure it is powered on.
2. **Start your CAT control software**:
   - **Option A (flrig):** Open `flrig`, configure your transceiver, and ensure "Init" is successful. Default XML-RPC port is usually `12345`.
   - **Option B (rigctld):** Run `rigctld -m <model> -r <device> -t 4532` (adjust model/device as needed).

### Step 3.2: Start the OpenHamClock Daemon
The OpenHamClock web app cannot talk directly to your rig; it needs a small bridge (daemon).

1. Navigate to the `rig-control/` directory in the project:
   ```bash
   cd rig-control
   ```
2. Install dependencies (first time only):
   ```bash
   npm install
   ```
3. Configure the daemon:
   - Edit `rig-config.json`.
   - Set `rigType` to `"flrig"` or `"hamlib"`.
   - Set `host` and `port` to match your CAT software (e.g., `127.0.0.1` and `12345` for flrig).
4. Start the daemon:
   ```bash
   node rig-daemon.js
   ```
   *Success Indicator: The terminal should show "Connected to flrig/hamlib on..." and "Listening on http://0.0.0.0:5555".*

### Step 3.3: Start OpenHamClock (Frontend)
1. In the main project directory, start the development server:
   ```bash
   npm run dev
   ```
2. Open the application in your browser (usually `http://localhost:5173`).

## 4. Configuration

1. Open **Settings** (Gear icon or click the "Station" header).
2. Navigate to the **Station** tab.
3. Scroll down to **Rig Control (Beta)**.
4. Check **Enable Hamlib / flrig integration**.
5. Set **Rig Daemon Host**: `http://localhost` (or IP of the machine running the daemon).
6. Set **Rig Daemon Port**: `5555`.
7. Check **Click-to-tune** (Controls whether ATU/Tune command is sent. Spot clicking always sets frequency).
8. Click **Save Settings**.

## 5. Test Cases

### TC-01: Connectivity Verification
**Objective:** Confirm OpenHamClock can read rig status.
1. Open the **Rig Control** panel (it should appear in your layout, or switch to "Modern" layout if not visible).
2. **Verify:** The status LED in the top-right of the panel is **GREEN**.
3. **Verify:** The large frequency display matches your rig's VFO A.
4. **Verify:** The mode badge (e.g., USB, CW) matches your rig.

### TC-02: Manual Control
**Objective:** Confirm OpenHamClock can command the rig via the panel.
1. In the Rig Control panel, enter a frequency (e.g., `14.074`) in the input box.
2. Click **Set**.
3. **Verify:** The rig physically changes to `14.074.000` Hz.
4. Change the mode on the rig manually (e.g., switch to CW).
5. **Verify:** The Rig Control panel updates to show "CW" within ~1 second.
6. Click and hold the **PTT** button.
7. **Verify:** The Rig switches to Transmit (`TX`) mode.
8. Release the **PTT** button.
9. **Verify:** The Rig returns to Receive (`RX`) mode.

### TC-03: On-Air Indicator
**Objective:** Confirm the On-Air panel reflects TX status.
1. Add the **On Air** panel to your layout (if using Dockable layout) or observe the PTT status.
2. Press PTT on the rig microphone OR use the on-screen PTT.
3. **Verify:** The On Air panel turns **RED** and displays "ON AIR".
4. Release PTT.
5. **Verify:** The panel returns to standard/gray "RX" state.

### TC-04: Click-to-Tune (Spot Integration)
**Objective:** Confirm clicking spots retunes the rig.
1. Open the **DX Cluster** panel or **POTA** panel.
2. Find a spot and click on it.
3. **Verify:** The rig retunes to the spot's frequency (regardless of "Click-to-tune" setting).
4. **Verify:** If "Click-to-tune" is checked, the rig's ATU/Tune cycle is triggered.
5. **Verify:** The rig mode changes automatically based on the new frequency.

### TC-05: Mode Logic Verification (Critical)
**Objective:** Verify that specific modes are enforced based on band conventions.

*NOTE: The logic enforces `< 10 MHz = LSB` and `>= 10 MHz = USB`, except for 60m (USB).*

| Test Step | Action | Expected Frequency | Expected Mode |
| :--- | :--- | :--- | :--- |
| **5.1** | Click a **20m FT8** spot (e.g., 14.074) | 14.074.000 | **USB** |
| **5.2** | Click a **40m FT8** spot (e.g., 7.074) | 7.074.000 | **LSB** |
| **5.3** | Click a **80m FT8** spot (e.g., 3.573) | 3.573.000 | **LSB** |
| **5.4** | Click a **20m CW** spot (e.g., 14.010) | 14.010.000 | **USB** |
| **5.5** | Click a **40m CW** spot (e.g., 7.010) | 7.010.000 | **LSB** |
| **5.6** | Click a **60m** spot (e.g., 5.357) | 5.357.000 | **USB** |

### TC-06: Error Handling
**Objective:** Confirm behavior when components fail.
1. Stop the `rig-daemon.js` (Ctrl+C in terminal).
2. **Verify:** The Rig Control panel status LED turns **RED** (within ~5 seconds).
3. **Verify:** An error banner "Daemon not reachable" appears in the panel.
4. Restart the daemon.
5. **Verify:** The panel recovers to **GREEN** automatically.

### TC-07: Configurable Tune Delay
**Objective:** Verify that the ATU trigger duration can be customized.
**Prerequisite:** Feature "Click-to-tune" enabled in Settings.

| Test Step | Action | Expected Behavior |
| :--- | :--- | :--- |
| **7.1** | Default Config | Stop daemon. Ensure `tuneDelay` is `3000` (or missing) in `rig-config.json`. Start daemon. Click a spot. Verify "Tune" (or PTT) lasts ~3 seconds. |
| **7.2** | Custom Config | Stop daemon. Edit `rig-config.json`: set `"tuneDelay": 5000`. Start daemon. Click a spot. Verify "Tune" (or PTT) lasts ~5 seconds. |

## 6. Cleanup
- Stop the daemon (`Ctrl+C`).
- Stop the frontend (`Ctrl+C`).
- (Optional) Uncheck "Enable Hamlib integration" in Settings if returning to normal use without the daemon.
