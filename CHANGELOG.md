# Changelog

All notable changes to Pirate Network are documented in this file.

## [0.3.1.0] - 2026-07-22

### Added

- The live Polygon mainnet deployment record now publishes contract `0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff`, transaction `0x29c1ec7013fa8a953ce318f09e6bee9cc7b5b3b191c49e0885a961459091584e`, block `90639970`, the exact deadline, and the public security-review and Sourcify evidence.

### Changed

- The landing page and production environment samples now use Polygon chain `137`, the immutable `300 POL` minimum, the deployed mainnet escrow, and generated `PIRATE-POL-*` licenses backed by shared Redis.
- Campaign copy now clearly states that POL has real monetary value, approval is permanent, and unapproved refunds require an on-chain transaction after the deadline.

### Fixed

- The reviewed Trust Wallet handoff now uses exact `localhost`, which is covered by the extension's host permissions, while preserving a fresh ephemeral-port origin and strict DNS-rebinding protection.
- Wallet discovery still prefers EIP-6963 but can use only Trust Wallet's explicit legacy provider; unmarked generic injected wallets remain rejected.

### Security

- Frontend and product-key services fail closed unless the exact mainnet contract and chain match, and Polygon mainnet refuses SQLite/inventory key mode.
- Sourcify independently reproduced exact creation and runtime bytecode matches with Solidity `0.8.30`, optimizer `200`, and EVM target `paris`.

## [0.3.0.3] - 2026-07-21

### Added

- Operators can now deploy the reviewed Polygon mainnet escrow through a localhost-only Trust Wallet handoff without exposing a recovery phrase, private key, or authenticated RPC URL to the browser.
- The deployment record now includes reproducible creation-bytecode and constructor-bound initcode fingerprints for the approved beneficiary and immutable `300 POL` minimum.

### Changed

- Mainnet preflight compiles the contract from the exact reviewed Git commit, pins the approved owner, beneficiary, price, and full initcode, and refuses non-HTTPS RPC endpoints.
- Deployment success now requires 20 confirmations from the separate dedicated RPC plus exact transaction, deployment-block, owner, beneficiary, minimum, deadline, phase, and release-state verification.

### Security

- A controller-bound durable journal permanently locks ambiguous attempts, accepts only the first returned transaction hash, and permits verification only for that same hash; even a reported wallet rejection requires manual chain reconciliation.
- Expanded contract and handoff tests cover exact deadline behavior, reentrancy, reverting refund receivers, forced POL, wallet/account/network drift, localhost attacks, concurrent controllers, and immutable-state mismatches. Independent external audit remains a mandatory launch gate.
- Trust Wallet reconnection now replaces stale provider listeners, while localhost Host validation safely accepts case-insensitive DNS names without weakening the exact-origin check.
- Standalone and workspace installs pin Ganache's Lodash dependency to the fixed `4.18.1` test-only release.

## [0.3.0.2] - 2026-07-21

### Added

- The integrated AWS service can now use DevOps-managed standard Redis directly through `REDIS_URL`, while the existing Upstash REST transport remains available for Vercel.

### Changed

- Mainnet product-key assignments, challenges, and rate limits now share one lazily connected, gracefully closed Redis client without requiring CDK or GitHub Actions changes.
- Production guidance now documents the direct environment variables, TLS/authenticated non-cluster Redis endpoint, backups, and independent product-key secrets required for launch.

### Security

- Polygon mainnet startup now refuses inventory/SQLite mode, standard Redis rejects insecure production URLs and clustered endpoints, and stalled Redis connections are bounded by the configured timeout.

## [0.3.0.1] - 2026-07-21

### Changed

- Mainnet preflight now records the approved dedicated Trust Wallet EOA as an explicit custody exception instead of misclassifying it as a hardware wallet or multisig.
- The landing page now links to a public mainnet release-criteria page that defines the usable-product threshold, approval finality, and exact refund transaction requirement.
- The deployment record now captures the owner's offline recovery-backup attestation and KyungJu Lee's `300 POL` business price approval.

### Security

- Trust Wallet deployment remains blocked until permanent hot-wallet custody risk and an offline recovery backup are explicitly attested; the preflight still accepts no wallet secret and cannot broadcast a transaction.
- A reviewer-ready independent audit template documents the exact build, threat model, required invariants, and findings format without claiming that an audit has occurred.

## [0.3.0.0] - 2026-07-21

### Added

- Mainnet generated mode now guarantees one stable `PIRATE-POL-*` license for every approved wallet without finite inventory, using deployment-bound HMAC-SHA-256 generation and encrypted atomic Redis assignments.
- A no-CDK AWS mainnet environment sample, deployment record, and release-criteria draft capture the approved Safe/beneficiary address, `300 POL` minimum, shared Redis requirements, and remaining launch evidence.

### Changed

- The integrated AWS Node service selects shared Redis instead of SQLite when `PRODUCT_KEY_MODE=generated`, while preserving the existing SQLite and Redis inventory behavior for the Amoy rehearsal.
- Redis generated mode fingerprints both server secrets and the chain/contract context, rejects namespace reuse or secret drift, and disables inventory uploads.

### Security

- Mainnet preparation now fails closed when the intended Polygon Safe is uninitialized, unfunded, missing audit/price evidence, or checked out from a dirty source tree; no deployment transaction is signed or broadcast by the preflight.

## [0.2.0.2] - 2026-07-21

### Changed

- Approved supporters now get a clear recovery message when product-key inventory is empty, requests are rate limited, or the service is unavailable, without being told to approve again.
- AWS health checks now separate process liveness from storage/RPC readiness, so the load balancer stops wallet-verification traffic without restarting a healthy container during a dependency outage.

### Fixed

- The Amoy AWS service now opens its existing SQLite database in an EFS-compatible rollback-journal mode, preserves assigned keys during the transition, and refuses startup if the transition is blocked.
- SQLite failures now provide allowlisted diagnostic codes in production logs without exposing database paths, SQL, or private error details.

## [0.2.0.1] - 2026-07-20

### Changed

- The Amoy rehearsal now uses Polygon's current public dRPC endpoint when reading escrow state or helping a wallet add the network.

### Fixed

- The AWS-served landing page now permits its intended Google font and Cloudflare Insights resources without weakening the remaining content security policy.
- The mobile story section no longer creates horizontal page overflow at compact viewport widths.

## [0.2.0.0] - 2026-07-20

### Added

- The deployed landing-page origin can now serve wallet challenges, approved-wallet product-key redemption, readiness checks, and authenticated inventory administration through Vercel Functions backed by Upstash Redis.
- Operators can import up to 1,000 keys at once, monitor quarantined inventory, and restore a clean backup copy after corrupt encrypted inventory is isolated.
- Repository-root Node 22 checks now validate the contract, browser journey, local service, Vercel routes, Redis coordination, and deployment configuration in CI.
- Desktop and compact navigation now link directly to the refundable pre-order section with a touch-friendly mobile target.

### Changed

- Product-key storage supports asynchronous shared adapters while preserving the local SQLite workflow, and shared Redis now coordinates expiring challenges, cross-instance rate limits, and atomic stable key assignment.
- Production startup pins the backend to the same Polygon contract and chain as the public landing page, validates numeric safety limits, bounds upstream calls, and separates container liveness from dependency readiness.
- Redis inventory uses versioned AES-256-GCM encryption, revalidates its namespace key before mutation, quarantines corrupt ciphertext safely, and supports normal re-import from backup.
- The Amoy rehearsal now states that approval creates eligibility for an available key; mainnet remains blocked until an enforceable one-key-per-supporter guarantee is designed and tested.

### Fixed

- Upstream RPC and Redis failures can no longer expose authenticated URLs or provider messages through API responses or production logs.
- Successful and failed readiness checks are briefly cached to reduce unauthenticated dependency-call amplification during normal polling and outages.
- Vercel rate limiting trusts the platform-provided client address instead of a caller-controlled forwarding-header value.

## [0.1.2.0] - 2026-07-18

### Added

- A tested multi-stage Docker image runs the landing page and product-key service as a non-root user with a persistent `/data` volume and container health check.
- An AWS ECS/Fargate environment template and deployment guide cover Secrets Manager, EFS, HTTPS load balancing, task health checks, and the current single-task storage constraint.

### Changed

- Trusted-proxy rate limiting now uses the client address appended by an AWS Application Load Balancer instead of trusting a user-controlled forwarding-header prefix.

## [0.1.1.0] - 2026-07-17

### Added

- A read-only Polygon mainnet preflight validates chain ID, public custody addresses, review evidence, deployer gas balance, immutable pledge conversion, and the compiled contract fingerprint without accepting wallet secrets or sending transactions.
- A staged mainnet launch runbook covers price approval, release criteria, independent audit, owner/beneficiary custody, source verification, configuration cutover, and the production canary.

### Changed

- The Solidity compiler dependency is pinned to `0.8.30` for reproducible deployment review.
- Mainnet documentation now makes the deployer-as-immutable-owner constraint explicit and keeps the public landing page on Amoy until every production gate passes.

## [0.1.0.0] - 2026-07-17

### Added

- Supporters can rehearse a 30-day refundable pre-order on Polygon Amoy, review public release evidence, approve individually, or reclaim an unapproved pledge after the deadline.
- Approved wallets can verify ownership with a one-use signature and retrieve one stable product key from the integrated service.
- Project administrators can record release evidence from the owner wallet and load private product-key inventory through an authenticated API.
- Automated contract, wallet-flow, API, persistence, configuration, and browser behavior checks now run in CI.

### Changed

- The landing page now explains the exact approval and refund process, shows live on-chain state, and reveals product-key access only after approval.
- The landing page and key service are served from one origin with security headers, bounded ephemeral state and verification concurrency, RPC timeouts, restricted database permissions, and a startup check that prevents contract-address drift.
- Ambiguous wallet-provider responses are persisted and block duplicate value-moving actions until the on-chain result can be reconciled.
- Beneficiaries can withdraw only the funds that supporters explicitly approved; unapproved pledges remain outside the withdrawable balance.
