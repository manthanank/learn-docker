# Security Policy

## Supported Versions

We release patches and security advisories for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.3.x   | :white_check_mark: |
| 1.2.x   | :x:                |
| < 1.2   | :x:                |

## Reporting a Vulnerability

The security of containerized systems is paramount. If you discover a vulnerability in `learn-docker` or its simulated runtimes:

1. **Do not open a public GitHub issue.**
2. Send an email to `security@manthanank.dev` with:
   - Description of the vulnerability (e.g., privilege escalation, container breakout, unsafe parsing, secret leakage).
   - Steps to reproduce or proof-of-concept Dockerfile/Compose spec.
   - Affected version(s) and proposed remediation if available.
3. You will receive an initial response within 48 hours.
4. Coordinated disclosure will follow standard 90-day industry timelines once a fix is validated and released.
