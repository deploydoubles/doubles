# Deploy Doubles specification — v0.1 (draft)

Authored by Jan Peter Wiersma. Licensed under [CC BY 4.0](LICENSE).

| Document | What it defines |
|---|---|
| [report.md](report.md) | The report an application serves at `/.well-known/deploy-report` |
| [security.md](security.md) | The two tiers, the token, and what a report never contains |
| [outside-checks.md](outside-checks.md) | What a verifier observes from outside, and its exit codes |
| [manifest.md](manifest.md) | `double.json`: what an application needs and which checks must pass |

JSON Schemas (2020-12): [`schema/report-v0.1.json`](schema/report-v0.1.json), [`schema/manifest-v0.1.json`](schema/manifest-v0.1.json). Examples are in [`examples/`](examples/).

v0.x is a draft: breaking changes are allowed until 1.0, and proposals are discussed in the open in the `deploydoubles/doubles` repository.
