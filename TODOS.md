# Mainnet launch follow-ups

The Amoy rehearsal is complete. Do not accept real Polygon mainnet funds until every blocking item below is closed.

## Completed preparation

- [x] Add a read-only chain/custody/price/audit preflight that cannot access wallet secrets or deploy a contract.
- [x] Pin the Solidity compiler version and document the exact optimizer and EVM settings used for the deployment fingerprint.
- [x] Write a staged Polygon mainnet runbook that keeps the public page on Amoy until source and constructor verification pass.

## Security and custody

- [ ] Obtain an independent Solidity audit, including malicious receiver, transfer-failure, and reentrancy tests.
- [ ] Put the contract owner and beneficiary roles behind a reviewed multisig or hardware-wallet process; document the release transaction approval policy.
- [ ] Resolve the immutable-owner deployment path: the current deployer becomes `owner`, so a multi-administrator launch needs a reviewed multisig direct-deployment mechanism or an explicit-owner constructor revision followed by audit.
- [ ] Verify the final source and constructor arguments on PolygonScan before publishing the mainnet address.
- [ ] Require finalized or sufficiently confirmed approval state before assigning an irreversible product key.
- [ ] Resolve or formally isolate the audit findings in the Ganache/Solidity development toolchain before running it on untrusted contributions; the production dependency audit is currently clean.

## Product and pricing

- [ ] Guarantee one product key for every supporter before mainnet approval can irreversibly release a pledge. Choose an enforceable reservation or unlimited-license design, then test inventory exhaustion and concurrent approvals end to end.
- [ ] Approve the mainnet minimum pledge with finance/legal review. `250 POL` is only a proposal; Polygon USDC pricing remains intentionally deferred.
- [ ] Publish objective, supporter-visible acceptance criteria for “product released” and the exact Product Hunt or product URL that may be recorded as proof.
- [ ] Complete the Korean localization of live escrow controls and wallet/error states; the Amoy transaction controls currently remain explicitly English.

## Production service

- [x] Add Vercel Functions backed by shared Redis TTL challenges, shared rate limits, and atomic cross-instance per-wallet issuance coordination.
- [x] Encrypt Redis product-key inventory with a server-only AES-256-GCM key before storage.
- [ ] Replace the Amoy-only SQLite/EFS rehearsal store with a backed-up client/server datastore before mainnet; migrate inventory and wallet assignments, then test rollback and recovery.
- [ ] Provision the production Redis integration, restrict its credentials, enable persistence/backups, add inventory monitoring, and test the recovery procedure.
- [ ] Use a dedicated authenticated Polygon RPC, reduce campaign-read bursts, and monitor provider throttling and chain reorganizations.
- [ ] Run end-to-end staging tests for wrong-network switching, receipt timeout/revert recovery, CORS/proxy behavior, graceful shutdown, and concurrent key redemption.
