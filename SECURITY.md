# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email **dev@hauskayu.com** with:

- what is affected (version, file or endpoint),
- how to reproduce it, and the impact you expect,
- whether you would like to be credited.

We answer within 3 working days and aim to ship a fix within 30 days, sooner for anything that can move money or expose
credentials. We will tell you when the fix is released and, if you agree, credit you in the CHANGELOG.

If the problem is in doit.id itself (their API, portal or hosted page), report it to doit.id directly.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (beta) | Yes |

## Scope notes

- Never include real API keys, signing secrets or customer data in a report. Use a `pb_test_` key.
- The plugin stores credentials encrypted with `DOIT_ENCRYPTION_KEY`; keeping that key and your database safe is the
  store operator's responsibility.

---

Laporkan celah keamanan secara privat ke **dev@hauskayu.com**, jangan lewat issue publik. Kami membalas dalam 3 hari kerja.
