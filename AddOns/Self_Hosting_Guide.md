# Running AddOns with a Self-Hosted OpenHamClock

If you are running OpenHamClock locally (e.g., on a Raspberry Pi, a Docker container, or your own server) instead of using `openhamclock.com`, you need to adjust the Userscripts to match your local URL or IP address.

By default, the scripts are restricted to `https://openhamclock.com/*` for security reasons.

## How to adapt the scripts

1. **Open your Userscript Manager** (Tampermonkey, Greasemonkey, etc.).
2. **Select the script** you want to edit (e.g., _APRS Newsfeed_).
3. **Locate the Metadata block** at the top of the script.
4. **Add or change the `@match` line** to include your local address.

### Examples

**For a local Raspberry Pi (via hostname):**

```javascript
// @match        http://hamclock.local/*
```

**For a local IP address:**

```javascript
// @match        http://192.168.1.100:3000/*
```

**To allow both the official site and your local instance:**
You can simply add multiple `@match` lines:

```javascript
// ==UserScript==
// ...
// @match        https://openhamclock.com/*
// @match        http://192.168.1.50/*
// ...
// ==/UserScript==
```

## Security Note

Avoid using `*://*/*` as a match pattern. This would allow the script to run on every website you visit, which could expose your `aprs.fi` API key or other sensitive data to malicious sites. Always restrict the script to the specific URLs where you actually use OpenHamClock.

---

_73 de DO3EET_
