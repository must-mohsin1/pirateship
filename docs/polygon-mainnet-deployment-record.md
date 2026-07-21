# Polygon mainnet deployment record

This document records the approved public deployment inputs and the remaining
evidence required before the irreversible wallet transaction. It contains no
secret, seed phrase, private key, RPC credential, or administrator token.

## Approved campaign inputs

| Field | Approved value |
| --- | --- |
| Network | Polygon PoS mainnet |
| Chain ID | `137` |
| Gas token | `POL` |
| Owner and direct deployer | `0xcF9178cA7360066B25de9c142A4c155abf151D6f` |
| Beneficiary | `0xcF9178cA7360066B25de9c142A4c155abf151D6f` |
| Custody mode | Dedicated Trust Wallet EOA; permanent single-owner exception |
| Minimum pledge | `300 POL` |
| Minimum pledge in wei | `300000000000000000000` |
| Product-key model | Unlimited deterministic license per approved wallet |
| Product-key datastore | Shared Redis; SQLite/EFS prohibited for mainnet |

## Recorded approvals and attestations

| Evidence | Recorded value |
| --- | --- |
| Business price approval | `300 POL`, approved 21 July 2026 by KyungJu Lee, Lead of the AX Booster Team and AI Engineering |
| Hot-wallet risk | Explicitly accepted by the project owner for the dedicated Trust Wallet EOA |
| Recovery backup | Project owner confirmed the recovery phrase is backed up offline; the phrase was not requested or recorded |
| Proposed public release-criteria URL | `https://pirateship.must.company/mainnet-release-criteria.html` |

## Current on-chain verification

PolygonScan identified the approved owner as an EOA and showed `11.7 POL` after
one incoming funding transaction on 21 July 2026. Before deployment, confirm the
same address and Polygon PoS mainnet inside Trust Wallet and rerun the dedicated
RPC checks. The Trust Wallet account is a permanent single-owner exception, not
a multisig or hardware wallet.

## Evidence still required

- [x] PolygonScan identifies the owner address as an EOA and shows `11.7 POL`.
- [x] The owner explicitly accepts permanent hot-wallet custody risk.
- [x] The owner confirms an offline recovery backup without sharing it.
- [ ] Two people independently compare the Trust Wallet and PolygonScan address.
- [ ] The final preflight confirms sufficient POL through the dedicated RPC.
- [ ] An independent audit report identifies the exact source commit and compiler settings.
- [x] The authorized team lead approved the `300 POL` business price.
- [ ] The prepared release criteria are deployed and reachable at `https://pirateship.must.company/mainnet-release-criteria.html`.
- [ ] A dedicated authenticated mainnet RPC is configured.
- [ ] Redis backup, restore, monitoring, and secret recovery have been tested.
- [ ] The usable product validates the generated `PIRATE-POL-*` licenses.
- [ ] The final clean source commit and creation-bytecode hash are recorded below.

## Final deployment output

Fill this section only after every evidence item above is complete.

| Field | Final value |
| --- | --- |
| Source commit | Pending |
| Solidity compiler | `0.8.30` |
| Optimizer | enabled, `200` runs |
| EVM target | `paris` |
| Creation bytecode hash | Pending final clean commit |
| Audit report URL | Pending |
| Release criteria URL | `https://pirateship.must.company/mainnet-release-criteria.html` (publication pending) |
| Deployment transaction | Pending |
| Contract address | Pending |
| Deployment block | Pending |
| Deadline | Pending on-chain verification |
