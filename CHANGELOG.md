# Changelog

All notable changes to Pirate Network are documented in this file.

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
