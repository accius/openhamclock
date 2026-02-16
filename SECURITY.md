# Security Policy

The OpenHamClock community takes security seriously. We appreciate responsible disclosure and will work to resolve security issues promptly to protect the amateur radio community.

---

## 1. Supported Versions

As a rapidly evolving open-source project, we primarily support the latest version of the codebase. Please reproduce issues on the latest `main` before reporting (when feasible).

| Version | Supported          | Notes                                  | End of Support |
| :------ | :----------------- | :------------------------------------- | :------------- |
| Main    | :white_check_mark: | The latest commit on the `main` branch | N/A (rolling)  |
| Older   | :x:                | Please upgrade to the latest version   | Immediate      |

---

## 2. Scope

### 2.1 In Scope
The following are within the scope of this vulnerability disclosure policy:
- OpenHamClock application code (frontend and backend)
- Configuration defaults and deployment artifacts in this repository
- Build, packaging, and update mechanisms owned by this repository
- Docker images and container configurations published by this project
- Installation and update scripts (`setup-*.sh`, `update.sh`)

### 2.2 Out of Scope
The following are generally **not** in scope but may be considered on a case-by-case basis:
- Third-party services and APIs consumed by OpenHamClock (report to the respective vendor)
- Vulnerabilities in upstream dependencies that do not materially affect this project's usage
- Issues requiring physical access to the user's device (unless remote access was enabled in an unsafe manner by default configuration)
- Social engineering attacks against individual operators
- Issues in end-of-life or unsupported versions

### 2.3 Scope Questions
If you're unsure whether something is in scope, **please report it anyway** and clearly mark it as a **"scope question"** in your submission. We will provide guidance.

---

## 3. Security Contact 

For vulnerability reports, please use one of the **private channels** below. The maintainer acts as the primary security contact and may engage additional community members under NDA for remediation when necessary.

---

## 4. Reporting a Vulnerability (ISO/IEC 29147 §7.4)

> **CRITICAL**: **DO NOT** open a public GitHub Issue for security vulnerabilities before coordination.

### 4.1 Reporting Channels (in order of preference)

#### Primary: GitHub Private Vulnerability Reporting
- **URL**: https://github.com/accius/openhamclock/security/advisories/new
- **Advantages**: Structured submission, built-in secure communication, CVE assignment support
- **Expected acknowledgment**: Automated immediate, human review within 7 days

#### Secondary: Encrypted Email
- **Address**: chris@cjhlighting.com
- **PGP Key**: Available at https://github.com/accius.gpg (or keybase.io/accius)
- **Fingerprint**: `[Will be added - use PGP key for sensitive communications]`
- **Use when**: GitHub reporting is unavailable or for highly sensitive disclosures

#### Tertiary: Direct Message
- **Platform**: Twitter/X DM to @[handle] (if urgent and other channels fail)
- **Note**: Less secure; use only for initial contact, then switch to encrypted channel

### 4.2 What to Include in Your Report (ISO/IEC 29147 §7.4.3)

A complete vulnerability report should include:

**Required**:
- **Vulnerability type** (e.g., SQL injection, XSS, authentication bypass, RCE, information disclosure)
- **Affected component(s)** (e.g., `server.js`, auto-update mechanism, Docker configuration)
- **Affected version(s)** (commit hash or version tag)
- **Description** of the vulnerability and how it manifests
- **Steps to reproduce** or proof-of-concept (minimal example preferred)
- **Impact assessment** (what can an attacker achieve?)

**Optional but helpful**:
- **Severity assessment** (your opinion: Critical/High/Medium/Low)
- **Suggested remediation** or mitigation approach
- **Disclosure preferences** (embargo duration, credit preferences)
- **CVE ID** if you've already requested one

### 4.3 Sensitive Data Handling

To protect operator privacy, **please avoid including**:
- Real amateur radio callsigns (use `K0XXX` or `W1ABC` as placeholders)
- Actual grid locators (use `AA00aa` as placeholder)
- Production IP addresses (use RFC5737 documentation addresses: `192.0.2.0/24`)
- API keys, tokens, session cookies, or contents of `.env` files
- Personal information of operators (names, addresses, email addresses)

If sensitive data is **absolutely necessary** for reproduction:
- Redact or pseudonymize it
- Clearly explain what was redacted and why it's needed
- Offer to provide actual data over a secure side-channel if essential

### 4.4 Language
Reports may be submitted in **English** (preferred) or other languages. We will make reasonable efforts to work with non-English reporters but may experience delays in processing.

---

## 5. Vulnerability Handling Process (ISO/IEC 30111:2019 §7)

### 5.1 Vulnerability Case Lifecycle

Each reported vulnerability is assigned a unique **case identifier** (format: `OHC-YYYY-NNNN`, e.g., `OHC-2026-0001`) and progresses through these states:

| State | Description | Typical Duration |
|-------|-------------|------------------|
| **RECEIVED** | Report received, awaiting initial review | 0-7 days |
| **ASSIGNED** | Case assigned to handler, analysis started | 1-14 days |
| **CONFIRMED** | Vulnerability validated and reproduced | - |
| **REMEDIATION** | Fix in development and testing | 7-90 days |
| **VENDOR-FIX** | Fix ready, coordinating disclosure | 0-14 days |
| **PUBLIC** | Vulnerability and fix publicly disclosed | Terminal state |
| **REJECTED** | Not a vulnerability or out of scope | Terminal state |

**Status transitions** will be communicated to the reporter via the reporting channel.

### 5.2 Response Timelines (ISO/IEC 29147 §7.4.4)

We commit to the following response targets:

- **Initial acknowledgment**: Within **7 calendar days** of receipt
- **Preliminary assessment**: Within **14 calendar days** of receipt  
- **Regular updates**: At least every **14 calendar days** while case is active
- **Target remediation**: Within **90 days** for Critical/High severity issues

> **Note**: Complex issues, multi-party coordination, or resource constraints may extend timelines. We will communicate delays proactively.

### 5.3 Severity Classification (CVSS v3.1)

We use CVSS v3.1 base scores to classify severity:

| Severity | CVSS Score | Response Priority | Typical Fix Timeline |
|----------|-----------|-------------------|---------------------|
| **Critical** | 9.0 - 10.0 | Immediate | 7-30 days |
| **High** | 7.0 - 8.9 | Urgent | 30-60 days |
| **Medium** | 4.0 - 6.9 | Normal | 60-90 days |
| **Low** | 0.1 - 3.9 | Best effort | Next release cycle |

Reporters are encouraged to provide their own CVSS assessment, but the PSIRT makes the final determination.

### 5.4 Remediation Development (ISO/IEC 30111 §7.5)

Remediation may take the form of:
1. **Code fix**: Patch applied to the codebase
2. **Configuration change**: Secure defaults or documentation update
3. **Workaround**: Interim mitigation until a full fix is available
4. **No fix**: Issue is accepted as a limitation (risk accepted, documented)

All fixes undergo internal testing before release. For Critical issues, we may request assistance from the reporter for verification.

---

## 6. Coordinated Disclosure (ISO/IEC 29147 §7.5)

### 6.1 Disclosure Timeline

By default, we follow a **90-day coordinated disclosure** timeline from initial report:

- **Day 0**: Vulnerability reported
- **Day 7**: Initial acknowledgment and triage
- **Day 14-90**: Remediation development, testing, and coordination
- **Day 90**: Public disclosure (advisory + fix), unless extended by mutual agreement

### 6.2 Early Disclosure

We may disclose **earlier than 90 days** if:
- Fix is ready and tested
- No multi-party coordination is required
- Reporter agrees to early disclosure
- Active exploitation is detected in the wild (emergency disclosure)

### 6.3 Embargo Extensions

The 90-day timeline may be **extended** if:
- Complexity requires additional development time (negotiated with reporter)
- Multi-party coordination is in progress (see §7)
- Affected component is in a third-party dependency awaiting upstream fix

**Maximum embargo**: Typically **180 days** from initial report, except in exceptional circumstances.

### 6.4 Emergency Disclosure

If we become aware of **active exploitation** or **imminent public disclosure**, we may:
1. Immediately publish a security advisory with available mitigations
2. Notify affected parties via established channels
3. Release a patch or workaround, even if incomplete

We will make reasonable efforts to notify the reporter before emergency disclosure.

### 6.5 Public Disclosure Content (ISO/IEC 29147 §7.5.3)

Our security advisories include:
- Vulnerability description (non-technical summary + technical details)
- Affected versions and components
- CVE identifier (if assigned)
- CVSS score and severity rating
- Impact and exploit conditions
- Remediation steps (upgrade path, workarounds, configuration changes)
- Credit to reporter (unless anonymity requested)
- Timeline of disclosure

**Disclosure channels**:
- GitHub Security Advisory (primary)
- CHANGELOG.md and release notes
- Project README / documentation
- Mailing list or community forum (if established)

---

## 7. Multi-Party Coordination (ISO/IEC TR 5895:2022)

### 7.1 When Multi-Party Coordination is Needed

We initiate multi-party coordination when a vulnerability:
- Affects **upstream dependencies** (e.g., Express, Node.js, npm packages)
- Impacts **downstream projects** (forks, derivatives, or integrations)
- Is present in **multiple projects** sharing similar code
- Requires involvement of a **neutral coordinator** (e.g., CERT/CC, MITRE)

### 7.2 Coordination Process (ISO/IEC TR 5895 §6.3)

When multi-party coordination is required:

1. **Identify stakeholders**: List all affected vendors/projects
2. **Establish communication**: Create a private coordination channel (email thread, CERT/CC case, GitHub security group)
3. **Share information**: Distribute vulnerability details under disclosure embargo
4. **Coordinate timelines**: Agree on a common disclosure date
5. **Synchronize patches**: Align release timing across parties
6. **Joint disclosure**: Publish advisories simultaneously (or in coordinated sequence)

### 7.3 Coordinator Roles

We may request assistance from:
- **CERT/CC** (cert.org) for high-impact vulnerabilities affecting multiple vendors
- **MITRE** (cve.org) for CVE assignment and management
- **GitHub Security Lab** for coordination within the GitHub ecosystem
- **NIST NVD** for CVE publication and enrichment

### 7.4 Information Sharing Restrictions

When participating in multi-party coordination:
- All parties operate under **confidentiality** until the agreed disclosure date
- Information may be shared with:
  - Directly affected vendors/projects (on need-to-know basis)
  - Neutral coordinators (CERT/CC, MITRE)
  - Security response organizations (e.g., OS/distro security teams)
- Information **must not** be shared with:
  - General public
  - Media or press (except coordinated embargoed briefings)
  - Unaffected third parties

### 7.5 Disclosure Date Negotiation

Target disclosure date is determined by:
- Complexity of remediation across all parties
- Criticality and exploit likelihood
- Default 90-day window (may be shorter or longer by agreement)
- Active exploitation status

If consensus cannot be reached, we follow the **earliest responsible disclosure date** that allows for remediation.

---

## 8. Reporter Credit and Recognition (ISO/IEC 29147 §7.4.5)

### 8.1 Credit Policy

We recognize and credit security researchers who responsibly disclose vulnerabilities:

- **Default**: Credit by name/handle in security advisories and release notes
- **Anonymous**: Opt-in anonymity respected ("Anonymous researcher")
- **No credit**: If reporter requests no attribution

### 8.2 Hall of Fame

We may maintain a **Security Researchers Hall of Fame** in this repository recognizing:
- Researchers who have reported valid vulnerabilities
- Year of report and severity classification
- Link to public advisory (if applicable)

*This section will be created when the first qualifying report is received.*

### 8.3 Bug Bounty Program

**Current status**: We do **not** operate a paid bug bounty program at this time.

Reporters contribute out of goodwill to protect the amateur radio community. We are deeply grateful for their efforts.

---

## 9. Safe Harbor and Legal Considerations

### 9.1 Good-Faith Security Research

We welcome and support **good-faith security research** conducted in accordance with this policy. We will not pursue legal action against researchers who:

- Act in good faith to identify and report vulnerabilities
- Make a reasonable effort to avoid privacy violations, data destruction, and service disruption
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Do not access, modify, or exfiltrate data beyond minimal proof-of-concept
- Report findings promptly and privately
- Wait for our coordinated disclosure before public discussion

### 9.2 Testing Guidelines

When testing for vulnerabilities:

- **Use your own infrastructure**: Test against your own deployment of OpenHamClock
- **Do not test production systems** operated by others without explicit written permission
- **Avoid service degradation**: No DoS attacks, no resource exhaustion, no brute-forcing
- **Respect privacy**: Do not access operator data, callsigns, locations, or logs of other users
- **No automated scanning** of public instances without prior approval

### 9.3 Responsible Disclosure Commitment

If you follow this policy, we commit to:
- Not pursue legal action related to your research
- Work with you to understand and validate the issue
- Acknowledge your contribution publicly (unless you prefer anonymity)
- Keep you informed throughout the remediation and disclosure process

---

## 10. Security Updates and Notifications

### 10.1 How to Stay Informed

Users and operators can stay informed of security updates via:

- **GitHub Security Advisories**: https://github.com/accius/openhamclock/security/advisories
- **GitHub Releases**: https://github.com/accius/openhamclock/releases (security fixes tagged)
- **CHANGELOG.md**: Maintained in the repository
- **Watch/Subscribe**: Enable "Security alerts" in your GitHub repository watch settings

### 10.2 Applying Security Updates

When a security update is released:

1. **Review the advisory**: Understand the impact and affected versions
2. **Check your version**: `git log -1 --pretty=format:"%H"` or `grep version package.json`
3. **Update immediately** for Critical/High severity:
   ```bash
   git pull
   npm install
   npm audit fix
   docker-compose up -d --build  # if using Docker
   ```
4. **Verify the fix**: Check that your version includes the patch commit
5. **Monitor for anomalies**: Review logs for signs of prior exploitation

---

## 11. Best Practices for Operators (Self-Hosting)

To reduce your vulnerability surface:

1. **Do not expose to the public internet**  
   Do not port-forward OpenHamClock directly to the internet unless it is protected behind a reverse proxy with TLS, authentication, and rate limiting.

2. **Protect your `.env` and secrets**  
   Treat `.env`, API keys, and configuration as secrets. Never commit them to public repositories. Use restrictive file permissions (`chmod 600 .env`).

3. **Update regularly**  
   Subscribe to security advisories and apply updates promptly:
   ```bash
   git pull
   npm install
   npm audit
   npm audit fix  # review changes before applying
   ```

4. **Run with least privilege**  
   Use a dedicated non-root user for the application. If using Docker, ensure the container runs as non-root.

5. **Enable security features**  
   - Set `NODE_ENV=production`
   - Configure `AUTO_UPDATE_ENABLED=false` if you prefer manual updates
   - Use HTTPS (TLS) for all connections
   - Enable rate limiting and authentication on admin endpoints

6. **Monitor for anomalies**  
   Review application logs regularly for suspicious activity (failed auth attempts, unusual API requests, etc.).

7. **Backup configuration**  
   Maintain backups of your configuration before applying updates.

---

## 12. Policy Review and Updates

This policy will be reviewed and updated:
- **Annually** (or more frequently as needed)
- When processes change materially
- After significant security incidents
- To align with evolving ISO/IEC standards

**History**:
- **v1.1** (2026-02-12): Enhanced ISO/IEC compliance, added multi-party coordination, severity classification, case lifecycle
- **v1.0** (Initial): Basic vulnerability disclosure policy

---

## 13. Contact and Questions

For questions about this policy (not vulnerability reports):
- **General security questions**: Open a public Discussion on GitHub
- **Policy clarifications**: Email chris@cjhlighting.com (non-confidential)

For **vulnerability reports**, see **§4 Reporting a Vulnerability**.

---

## 14. Acknowledgments

Thank you to the security research community for helping make OpenHamClock safer for the amateur radio community worldwide. Your responsible disclosures protect operators, preserve trust, and strengthen open-source security practices.

## Metadata

This policy aligns with international standards for vulnerability disclosure and handling:
- **ISO/IEC 29147:2018** - Vulnerability disclosure
- **ISO/IEC 30111:2019** - Vulnerability handling processes  
- **ISO/IEC TR 5895:2022** - Multi-party coordinated vulnerability disclosure and handling

**Document version**: 1.1  
**Last updated**: 2026-02-12  
**Next review**: 2026-08-12
