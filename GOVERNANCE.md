# Governance

Deploy Doubles is an open, vendor-neutral project. Started and stewarded by Strackt.

## Today

- **Author and maintainer**: Jan Peter Wiersma. He reviews and merges every change and is accountable for the specification.
- **Decisions** are made in the open, in issues and pull requests in this repository. Proposals to change the specification are discussed there before they land.
- **The specification is a draft (v0.x).** Breaking changes are allowed until 1.0. From 1.0, a version only changes additively.

## Neutrality

- Nothing in the specification, the verifier, the check libraries or the doubles is specific to one hosting platform. Platform-specific code — for example an adapter that compares one platform's detection with a manifest — lives in that platform's own repositories, not here.
- No platform gets a branded double, a privileged check, or early access to a specification change.
- Results that compare platforms are not published from this repository.

## The road to a standard

1. **Useful before standard.** The doubles and the verifier catch real deploy bugs first.
2. **Draft specification (v0.x)**, discussed in the open.
3. **A second, independent implementer before 1.0.**
4. **Formal registrations**: the `deploy-report` well-known URI (RFC 8615) and a media type.
5. **Maintainers from two or more organisations**, then a foundation.

## Transfer commitment

The `deploydoubles` GitHub organisation and the `deploydoubles.dev` domain are held by Jan Peter Wiersma. He commits to transferring them, together with the npm and Packagist names, to a neutral foundation if one accepts the project.
