# Rig Control User Guide

This guide will help you set up Rig Control for OpenHamClock so you can control your radio directly from the dashboard!

This feature allows you to:

- **See your radio's frequency** on the dashboard.
- **Click spots** on the map, DX cluster, or POTA/SOTA lists to instantly tune your radio.
- **Works in ALL Layouts**: Classic, Tablet, Compact, and Modern.
- **Trigger PTT** directly from the web interface.

---

## 📋 Choose Your Setup Scenario

There are **two ways** to use Rig Control with OpenHamClock:

### Scenario 1: Local Installation (Full Setup)
You install **both** OpenHamClock and the Rig Control daemon on your local computer. This is ideal for:
- Running everything on one machine (laptop, desktop, Raspberry Pi)
- Development and testing
- Offline operation

👉 **[Jump to Scenario 1 Instructions](#scenario-1-local-installation)**

### Scenario 2: Remote UI with Local Daemon
You use the OpenHamClock web interface from **openhamclock.com** (or another hosted instance) but run **only the Rig Control daemon** locally on the computer connected to your radio. This is ideal for:
- Using the hosted version without maintaining your own installation
- Accessing from multiple devices while keeping rig control local
- Simpler setup with fewer components to manage

👉 **[Jump to Scenario 2 Instructions](#scenario-2-remote-ui-with-local-daemon)**

---

# Scenario 1: Local Installation

## 🛠 Prerequisites

You need the following installed on the computer connected to your radio (e.g., Raspberry Pi, Mac, or PC):

1.  **Git:** To download the software.
    - [Download Git](https://git-scm.com/downloads)
2.  **Node.js:** The engine that runs OpenHamClock.
    - **Check:** Open a terminal and type `node -v`. (You want version 18 or higher).
    - **Install:** [Download Node.js LTS](https://nodejs.org/).
3.  **Radio Software:** One of the following must be running and connected to your radio:
    - **FLRIG (Recommended):** [Download FLRIG](http://www.w1hkj.com/files/flrig/)
    - **Hamlib (rigctld):** For advanced users.

---

## 📦 Step 1: Install OpenHamClock

1.  Open your terminal/command prompt.
2.  Download the code:
    ```bash
    git clone https://github.com/HAMDevs/openhamclock.git
    cd openhamclock
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Build the application:
    ```bash
    npm run build
    ```

---

## 🚀 Step 2: Install the Rig Control Daemon

The "Rig Control Daemon" is a separate small program that sits between OpenHamClock and your radio software.

1.  Navigate to the `rig-control` folder:
    ```bash
    cd rig-control
    ```
    _(If you are in the main folder, just type `cd rig-control`)_
2.  Install the daemon libraries:
    ```bash
    npm install
    ```

---

## ⚙️ Step 3: Configure the Daemon

Tell the daemon which radio software you use.

1.  Find `rig-config.json` in the `rig-control` folder. If it doesn't exist, it will be created automatically from `rig-config.json.example` when you first start the daemon.
2.  Edit it with any text editor.

### If using FLRIG (Easiest)

Ensure FLRIG is running and **XML-RPC** is enabled in its settings (Config > Setup > UI > XML-RPC).

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5555,
    "cors": "*"
  },
  "radio": {
    "type": "flrig",
    "host": "127.0.0.1",
    "port": 12345,
    "pollInterval": 1000,
    "pttEnabled": false
  }
}
```

### If using Hamlib (rigctld)

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5555,
    "cors": "*"
  },
  "radio": {
    "type": "rigctld",
    "host": "127.0.0.1",
    "port": 4532,
    "pollInterval": 1000,
    "pttEnabled": false
  }
}
```

---

## ▶️ Step 4: Start Everything

You need to run **two separate programs** for this to work. It is best to use two terminal windows.

### Window 1: Start OpenHamClock

In the main `openhamclock` folder:

```bash
npm start
```

- This will start the **Web Dashboard**.
- Standard Port: **3000**
- Access it at: `http://localhost:3000`

### Window 2: Start Rig Control Daemon

In the `openhamclock/rig-control` folder:

```bash
node rig-daemon.js
```

- This starts the **Daemon**.
- Standard Port: **5555**
- _Note: You do NOT visit this port in your browser. It runs in the background._

---

## 🔗 Step 5: Connect Them

1.  Open your browser to **http://localhost:3000**.
2.  Go to **Settings** (Gear Icon) > **Station Settings**.
3.  Scroll to **Rig Control**.
4.  Check **Enable Rig Control**.
5.  Set **Daemon URL** to: `http://localhost:5555`
    - _(This points the Dashboard on port 3000 to the Daemon on port 5555)_.
6.  **Optional:** Check **"Tune Button Enabled"** if you want to trigger your ATU.
7.  Click **Save**.

---

## ✅ You're Done!

Navigate to the dashboard. You should see the Rig Control panel (if enabled). 

**Try it out:**
- Click a spot on the **World Map**.
- Click a row in the **DX Cluster** list.
- Click a **POTA** or **SOTA** spot.
- Works across **Classic**, **Modern**, **Tablet**, and **Compact** layouts!

### Troubleshooting

- **"Connection Failed":** Ensure `node rig-daemon.js` is running in a terminal.
- **Radio won't tune:** Ensure FLRIG is running and connected to the radio.
- **Double check ports:**
  - Browser URL: `http://localhost:3000`
  - Settings Daemon URL: `http://localhost:5555`

---

# Scenario 2: Remote UI with Local Daemon

In this scenario, you use the OpenHamClock web interface from **openhamclock.com** (or another HTTPS-hosted instance) while running only the Rig Control daemon locally on the computer connected to your radio.

## 🛠 Prerequisites

You need the following installed on the computer connected to your radio:

1.  **Git:** To download the daemon software.
    - [Download Git](https://git-scm.com/downloads)
2.  **Node.js:** The engine that runs the daemon.
    - **Check:** Open a terminal and type `node -v`. (You want version 18 or higher).
    - **Install:** [Download Node.js LTS](https://nodejs.org/).
3.  **Radio Software:** One of the following must be running and connected to your radio:
    - **FLRIG (Recommended):** [Download FLRIG](http://www.w1hkj.com/files/flrig/)
    - **Hamlib (rigctld):** For advanced users.

---

## 📦 Step 1: Install the Rig Control Daemon Only

1.  Open your terminal/command prompt.
2.  Download the OpenHamClock repository (we only need the `rig-control` folder):
    ```bash
    git clone https://github.com/HAMDevs/openhamclock.git
    cd openhamclock/rig-control
    ```
3.  Install the daemon dependencies:
    ```bash
    npm install
    ```

---

## ⚙️ Step 2: Configure the Daemon

1.  Find `rig-config.json` in the `rig-control` folder. If it doesn't exist, it will be created automatically from `rig-config.json.example` when you first start the daemon.
2.  Edit it with any text editor.

### If using FLRIG (Easiest)

Ensure FLRIG is running and **XML-RPC** is enabled in its settings (Config > Setup > UI > XML-RPC).

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5555,
    "cors": "*"
  },
  "radio": {
    "type": "flrig",
    "host": "127.0.0.1",
    "port": 12345,
    "pollInterval": 1000,
    "pttEnabled": false
  }
}
```

### If using Hamlib (rigctld)

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5555,
    "cors": "*"
  },
  "radio": {
    "type": "rigctld",
    "host": "127.0.0.1",
    "port": 4532,
    "pollInterval": 1000,
    "pttEnabled": false
  }
}
```

---

## ▶️ Step 3: Start the Daemon

In the `openhamclock/rig-control` folder:

```bash
node rig-daemon.js
```

- This starts the **Daemon**.
- Standard Port: **5555**
- The daemon will run in the background and communicate with your radio software.

---

## 🔗 Step 4: Configure OpenHamClock Web UI

### Important: HTTPS → HTTP Mixed Content Issue

When you access OpenHamClock via **HTTPS** (e.g., `https://openhamclock.com`), your browser will **block** direct HTTP connections to your local daemon (`http://localhost:5555`) for security reasons. This is called a "Mixed Content" security policy.

**Different browsers handle this differently:**

| Browser | Behavior | Workaround Available? |
|---------|----------|----------------------|
| **Safari (macOS/iOS)** | ❌ Strictly blocks all mixed content | ❌ No workaround available |
| **Chrome** | ⚠️ Blocks by default | ✅ Click shield icon in address bar → "Load unsafe scripts" |
| **Firefox** | ⚠️ Blocks by default | ✅ Click shield icon in address bar → "Disable protection for this session" |
| **Edge** | ⚠️ Blocks by default | ✅ Click shield icon in address bar → Allow |

### ⚠️ Current Limitations

**Safari Users:** Unfortunately, Safari does not provide any way to override mixed content blocking. If you're using Safari, you have two options:
1. **Use a different browser** (Chrome, Firefox, or Edge) that allows mixed content overrides
2. **Run OpenHamClock locally** using Scenario 1 (both UI and daemon on HTTP)

**Chrome/Firefox/Edge Users:** You can use the browser's mixed content override feature (shield icon in address bar), but you'll need to re-enable it each time you reload the page.

### 📝 Configuration Steps

1.  Open **https://openhamclock.com** (or your hosted instance) in your browser.
2.  Go to **Settings** (Gear Icon) > **Station Settings**.
3.  Scroll to **Rig Control**.
4.  Check **Enable Rig Control**.
5.  Set **Daemon URL** to: `http://localhost:5555`
6.  **Optional:** Check **"Tune Button Enabled"** if you want to trigger your ATU.
7.  Click **Save**.
8.  **If using Chrome/Firefox/Edge:** Look for the shield icon in your browser's address bar and click it to allow mixed content.

> **💡 Recommendation:** For the best experience with rig control, consider using **Scenario 1** (local installation) where both the UI and daemon run on HTTP, avoiding mixed content issues entirely.

---

## ✅ You're Done!

Navigate to the dashboard at **https://openhamclock.com**. You should see the Rig Control panel (if enabled).

**Try it out:**
- Click a spot on the **World Map**.
- Click a row in the **DX Cluster** list.
- Click a **POTA** or **SOTA** spot.
- Works across **Classic**, **Modern**, **Tablet**, and **Compact** layouts!

### Troubleshooting

- **"Connection Failed":** 
  - Ensure `node rig-daemon.js` is running in a terminal.
  - Verify the daemon is listening on port 5555 (check terminal output).
  - **If using HTTPS UI:** Check for mixed content blocking (see browser-specific workarounds above).
  
- **Radio won't tune:** 
  - Ensure FLRIG or rigctld is running and connected to the radio.
  - Check the daemon terminal output for error messages.
  
- **Mixed Content Errors (Console):**
  - **Safari:** No workaround available. Use Chrome/Firefox/Edge or switch to Scenario 1.
  - **Chrome/Firefox/Edge:** Click the shield icon in the address bar to allow mixed content.
  - **Best Solution:** Consider using Scenario 1 (local installation) to avoid this issue entirely.

- **Firewall Issues:**
  - If the daemon is on a different machine than your browser, ensure port 5555 is open in your firewall.
  - Update the **Daemon URL** to use the daemon machine's IP address (e.g., `http://192.168.1.50:5555`).

---

## 🎯 Quick Reference

### Scenario 1 (Local Installation)
- **What you install:** OpenHamClock + Rig Control Daemon
- **What you run:** `npm start` (OpenHamClock) + `node rig-daemon.js` (Daemon)
- **Where you access UI:** `http://localhost:3000`
- **Daemon URL in Settings:** `http://localhost:5555`
- **Browser compatibility:** All browsers ✅
- **Mixed content issues:** None (both on HTTP)

### Scenario 2 (Remote UI)
- **What you install:** Rig Control Daemon only
- **What you run:** `node rig-daemon.js` (Daemon)
- **Where you access UI:** `https://openhamclock.com` (or your hosted instance)
- **Daemon URL in Settings:** `http://localhost:5555` (or `http://your-daemon-ip:5555`)
- **Browser compatibility:** Chrome/Firefox/Edge ✅ (with manual override) | Safari ❌
- **Mixed content issues:** Requires browser override on each page load (Chrome/Firefox/Edge only)
