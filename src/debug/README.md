# Debug Logging in the Console

## Overview

Logging is controlled via a querystring parameter:

```
?log=<level>
```

This system works by overriding `console.*` methods at app startup.

---

# Supported Log Levels

| Level | Behavior                    |
| ----- | --------------------------- |
| none  | No logs                     |
| error | Errors only                 |
| warn  | Warnings + errors (default) |
| info  | Info + warn + error         |
| debug | All logs                    |
| all   | All logs                    |

---

# Notes

## Default Behavior

- Defaults to `warn`
- Ensures important issues are always visible

---

## Page Reload Required

Changing the querystring requires a manual refresh.

---

## Global Impact

This override affects **all console calls globally**, including third-party libraries.

---

# `console.*` considerations

- Use `console.error` for real failures
- Use `console.warn` for unexpected but non-breaking issues
- Use `console.log` for debugging only
- Avoid leaving excessive logs in production code
