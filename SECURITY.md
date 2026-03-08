# Security Policy

## Supported Versions

Only the latest version on `main` is supported. Please reproduce issues against the latest code before reporting.

## Reporting a Vulnerability

> **DO NOT** open a public GitHub Issue for security vulnerabilities.

### How to Report

1. **GitHub Private Vulnerability Reporting** (preferred):
   https://github.com/accius/openhamclock/security/advisories/new

2. **Email**: chris@cjhlighting.com — use when GitHub reporting is unavailable or for highly sensitive disclosures.

### What to Include

If reporting via email, please use the following template:

```
Subject: [SECURITY] Brief description of vulnerability

Vulnerability type: (e.g., XSS, RCE, authentication bypass)
Affected component(s): (e.g., server.js, Docker config)
Affected version/commit:
Steps to reproduce:
  1.
  2.
  3.
Impact: (what can an attacker achieve?)
Suggested fix: (optional)
```

Avoid including real callsigns, grid locators, IP addresses, or API keys — use placeholders instead.

## Response

- **Acknowledgment**: Within 7 days
- **Assessment**: Within 14 days
- **Target fix**: Within 90 days for critical/high severity

We follow a 90-day coordinated disclosure timeline by default.

## Safe Harbor

We will not pursue legal action against researchers who act in good faith, report findings privately, and avoid data destruction or service disruption. Please test only against your own deployments.

## Security Updates

Stay informed via [GitHub Security Advisories](https://github.com/accius/openhamclock/security/advisories) and [Releases](https://github.com/accius/openhamclock/releases).
