# Rig Control User Guide

This guide will help you set up Rig Control for OpenHamClock so you can control your radio directly from the dashboard!

This feature allows you to:

- **See your radio's frequency** on the dashboard.
- **Click spots** on the map, DX cluster, or POTA/SOTA lists to instantly tune your radio.
- **Works in ALL Layouts**: Classic, Tablet, Compact, and Modern.
- **Trigger PTT** directly from the web interface.

---

## 🛠 Prerequisites

You need three things installed on the computer connected to your radio (e.g., Raspberry Pi, Mac, or PC):

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

If you haven't installed OpenHamClock yet, follow these steps.

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

## 🚀 Step 2: Install the Rig Control Bridge

The "Rig Control Bridge" (daemon) is a separate small program that sits between OpenHamClock and your radio software.

1.  Navigate to the `rig-control` folder:
    ```bash
    cd rig-control
    ```
    _(If you are in the main folder, just type `cd rig-control`)_
2.  Install the bridge libraries:
    ```bash
    npm install
    ```

---

## ⚙️ Step 3: Configure the Bridge

Tell the bridge which radio software you use.

1.  Find `rig-config.json` in the `rig-control` folder.
2.  Edit it with any text editor.

### If using FLRIG (Easiest)

Ensure FLRIG is running and **XML-RPC** is enabled in its settings (Config > Setup > UI > XML-RPC).

```json
{
  "rigType": "flrig",
  "flrig": {
    "host": "127.0.0.1",
    "port": 12345
  },
  "serverPort": 5555
}
```

### If using Hamlib (rigctld)

```json
{
  "rigType": "rigctld",
  "rigctld": {
    "host": "127.0.0.1",
    "port": 4532
  },
  "serverPort": 5555
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

- This starts the **Bridge**.
- Standard Port: **5555**
- _Note: You do NOT visit this port in your browser. It runs in the background._

---

## 🔗 Step 5: Connect Them

1.  Open your browser to **http://localhost:3000**.
2.  Go to **Settings** (Gear Icon) > **Station Settings**.
3.  Scroll to **Rig Control**.
4.  Check **Enable Rig Control**.
5.  Set **Host URL** to: `http://localhost:5555`
    - _(This points the Dashboard on port 3000 to the Bridge on port 5555)_.
6.  **Optional:** Check **"Tune Button Enabled"** if you want to trigger your ATU.

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
  - Settings Rig URL: `http://localhost:5555`
