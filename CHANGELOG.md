# Changelog

All notable changes to Pirate Network are documented in this file.

## [0.1.2.0] - 2026-07-18

### Added

- Vercel Function routes now serve health checks, signed-wallet challenges, product-key redemption, and authenticated inventory administration from the deployed landing-page origin.
- Upstash Redis provides shared expiring challenges, cross-instance rate limits, encrypted inventory, and atomic stable key assignment for approved wallets.
- Desktop and compact navigation now link directly to the refundable pre-order section.

### Changed

- Product-key service methods support asynchronous persistent adapters while keeping the local SQLite workflow intact.
- Production setup documentation now includes the required Vercel, Redis, Polygon RPC, administrator-token, and encryption-key configuration.

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
