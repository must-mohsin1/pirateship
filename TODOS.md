# Polygon mainnet launch follow-ups

The escrow is deployed and source-verified on Polygon PoS mainnet. Do not deploy
a replacement contract. This list tracks the application rollout and operating
work that remains.

## Completed

- [x] Approve the immutable `300 POL` minimum pledge.
- [x] Publish the personal security review against source commit `89018f0ee3b04538a7baab4cc58e7d03325bf7f4`.
- [x] Deploy the reviewed initcode from the approved owner wallet with zero transaction value.
- [x] Verify owner, beneficiary, minimum pledge, deadline, initial phase, receipt, and transaction input through an independent RPC read.
- [x] Publish exact creation and runtime source matches on Sourcify.
- [x] Publish objective release criteria and the escrow deadline.
- [x] Implement unlimited, stable per-wallet generated licenses backed by shared Redis.
- [x] Record the explicit single-owner Trust Wallet risk exception and offline recovery backup attestation.

## Before directing supporters to pledge

- [ ] Merge and deploy the mainnet frontend/API configuration in this release.
- [ ] Inject the production runtime values from `.env.aws-mainnet.example`: chain `137`, the deployed contract, generated-key mode, Redis, and two independent product-key secrets.
- [ ] Confirm `/api/live` and `/api/health` are healthy and the deployed landing page displays the exact contract, `300 POL` minimum, and deadline.
- [ ] Confirm the released product can validate generated `PIRATE-POL-*` licenses. Do not call `markProductReleased` until a usable product URL exists and satisfies the published criteria.
- [ ] Exercise a read-only production wallet connection and contract-state refresh. Because the minimum is `300 POL`, do not send a throwaway canary pledge from the deployer wallet; monitor the first authorized supporter pledge as the controlled canary.
- [ ] Enable alerts for RPC failures, Redis availability, secret-fingerprint mismatch, escrow events, and the deadline/refund queue.

## Accepted residual risks and non-blocking follow-ups

- [ ] Obtain an independent Solidity audit when a qualified external reviewer becomes available. The published personal review and Sourcify exact match do not constitute independent assurance.
- [ ] Move future campaign administration to reviewed multisig or hardware-wallet custody. This deployed contract's owner is immutable and remains the explicitly accepted Trust Wallet EOA.
- [ ] Replace the public dRPC launch fallback with a dedicated authenticated Polygon RPC when available.
- [ ] Retry the PolygonScan source-code badge after the explorer submission limit clears. Sourcify exact verification is already public.
- [ ] Test Redis backup/restore and the product-key secret recovery procedure without exposing secret values.
- [ ] Complete Korean localization of live escrow controls and wallet/error states.

## Release and refund operations

- [ ] Publish the usable product URL before 20 August 2026 at 20:15:52 UTC.
- [ ] After independently checking the usable product against the criteria, submit `markProductReleased` from the owner wallet and record the public proof URL.
- [ ] Monitor supporter approvals and generated-key delivery without asking anyone for wallet secrets.
- [ ] After the deadline, publish refund instructions and monitor unapproved pledges until supporters submit their refund transactions.
