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
| Custody mode | Safe multisig direct deployer |
| Minimum pledge | `300 POL` |
| Minimum pledge in wei | `300000000000000000000` |
| Product-key model | Unlimited deterministic license per approved wallet |
| Product-key datastore | Shared Redis; SQLite/EFS prohibited for mainnet |

## Current on-chain verification

Read-only checks against two Polygon mainnet RPC providers on 21 July 2026
returned `0x` for `eth_getCode` and `0x0` for `eth_getBalance` at the approved
owner address. The address is therefore not yet an initialized Polygon Safe and
has no mainnet POL for deployment gas. Initialize the Safe on chain, confirm its
owners and threshold in Safe Wallet, and fund it before rerunning preflight.

## Evidence still required

- [ ] The owner address has Safe contract code on Polygon mainnet.
- [ ] Two administrators independently confirm the Safe owner list and threshold.
- [ ] The Safe has enough POL for the estimated deployment and execution gas.
- [ ] An independent audit report identifies the exact source commit and compiler settings.
- [ ] Finance/legal marks the `300 POL` price review complete.
- [ ] The approved release criteria are published at a stable HTTPS URL.
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
| Release criteria URL | Pending |
| Deployment transaction | Pending |
| Contract address | Pending |
| Deployment block | Pending |
| Deadline | Pending on-chain verification |
