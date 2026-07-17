# Mainnet launch follow-ups

The Amoy rehearsal is complete. Do not accept real Polygon mainnet funds until every blocking item below is closed.

## Security and custody

- [ ] Obtain an independent Solidity audit, including malicious receiver, transfer-failure, and reentrancy tests.
- [ ] Put the contract owner and beneficiary roles behind a reviewed multisig or hardware-wallet process; document the release transaction approval policy.
- [ ] Verify the final source and constructor arguments on PolygonScan before publishing the mainnet address.
- [ ] Require finalized or sufficiently confirmed approval state before assigning an irreversible product key.

## Product and pricing

- [ ] Approve the mainnet minimum pledge with finance/legal review. `250 POL` is only a proposal; Polygon USDC pricing remains intentionally deferred.
- [ ] Publish objective, supporter-visible acceptance criteria for “product released” and the exact Product Hunt or product URL that may be recorded as proof.
- [ ] Complete the Korean localization of live escrow controls and wallet/error states; the Amoy transaction controls currently remain explicitly English.

## Production service

- [ ] Replace process-local rate limits and wallet challenges with shared TTL storage, cross-instance per-wallet issuance coordination, and a trusted-proxy policy.
- [ ] Move product keys to encrypted persistent storage with restricted service credentials, tested backups, inventory monitoring, and a documented recovery procedure.
- [ ] Use a dedicated authenticated Polygon RPC, reduce campaign-read bursts, and monitor provider throttling and chain reorganizations.
- [ ] Run end-to-end staging tests for wrong-network switching, receipt timeout/revert recovery, CORS/proxy behavior, graceful shutdown, and concurrent key redemption.
