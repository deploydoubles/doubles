# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a vulnerability.

You can expect an acknowledgement within five working days. We will agree a disclosure date with you once a fix is ready.

## Scope

Of particular interest:

- anything that makes a deploy report reveal what [spec/security.md](spec/security.md) says it must never contain — error text, hostnames, IP addresses, usernames, paths, connection strings, environment values, the token or the run ID;
- a way to obtain the full tier without the token, other than the application's own committed `tier: full`;
- a way to make the report endpoint run checks, dispatch jobs or write to a backing service;
- a token comparison that is not constant time.

The reference apps in `doubles/` serve the full tier publicly by design. That is not a vulnerability; a leak of anything on the never-include list from them is.
