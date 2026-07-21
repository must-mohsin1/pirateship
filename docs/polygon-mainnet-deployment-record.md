# Polygon mainnet deployment record

This document records the approved public deployment inputs, the verified
deployment output, and the remaining production-release evidence. It contains no
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
| Product-key model | Unlimited stable generated license per approved wallet |
| Product-key datastore | Shared Redis; SQLite/EFS prohibited for mainnet |

## Recorded approvals and attestations

| Evidence | Recorded value |
| --- | --- |
| Business price approval | `300 POL`, approved 21 July 2026 by KyungJu Lee, Lead of the AX Booster Team and AI Engineering |
| Hot-wallet risk | Explicitly accepted by the project owner for the dedicated Trust Wallet EOA |
| Recovery backup | Project owner confirmed the recovery phrase is backed up offline; the phrase was not requested or recorded |
| Proposed public release-criteria URL | `https://pirateship.must.company/mainnet-release-criteria.html` |

## Verified on-chain deployment

Transaction `0x29c1ec7013fa8a953ce318f09e6bee9cc7b5b3b191c49e0885a961459091584e`
deployed the escrow at `0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff` in Polygon
block `90639970`. The localhost controller waited for 20 confirmations and a
second read-only RPC check confirmed receipt status `1`, zero transaction value,
the exact reviewed initcode, and the expected immutable state. Sourcify reports
exact creation and runtime bytecode matches under match ID `42715122`.

## Evidence still required

- [x] PolygonScan identifies the owner address as an EOA and shows `11.7 POL`.
- [x] The owner explicitly accepts permanent hot-wallet custody risk.
- [x] The owner confirms an offline recovery backup without sharing it.
- [x] The deployer compared the Trust Wallet and PolygonScan address before signing.
- [x] The final preflight confirmed `11.7 POL` for gas through Polygon mainnet RPC.
- [x] The published security review identifies the exact source commit and compiler settings.
- [x] The authorized team lead approved the `300 POL` business price.
- [x] The release criteria are deployed at `https://pirateship.must.company/mainnet-release-criteria.html`.
- [ ] Replace the public `https://polygon.drpc.org` launch endpoint with a dedicated authenticated mainnet RPC.
- [ ] Redis backup, restore, monitoring, and secret recovery have been tested.
- [ ] The usable product validates the generated `PIRATE-POL-*` licenses.
- [x] The final clean source commit and constructor-bound deployment-initcode fingerprint are recorded below.

## Final deployment output

| Field | Final value |
| --- | --- |
| Source commit | `89018f0ee3b04538a7baab4cc58e7d03325bf7f4` |
| Solidity compiler | `0.8.30` |
| Optimizer | enabled, `200` runs |
| EVM target | `paris` |
| Creation bytecode Keccak-256 | `0x36e443390e90ae7c9162961873b9fea1c655926767021360d267da0ecaf74bd6` |
| Creation bytecode SHA-256 | `0xdbba12df303fc3a04c83fd8c64c25be01283de079c89a0d8051a64e8f576d0a6` |
| Constructor arguments | beneficiary `0xcF9178cA7360066B25de9c142A4c155abf151D6f`; minimum `300000000000000000000` wei |
| Deployment initcode Keccak-256 | `0x8bc7eee692572585c17f69febde2b84ef02ca80ea562bc15d22de860bd561f94` |
| Deployment initcode SHA-256 | `0x3467325d97e41fd34ff2737ec51111716482d0a0621b8c507e3bab81b9b4ade5` |
| Mined transaction input Keccak-256 | `0x8bc7eee692572585c17f69febde2b84ef02ca80ea562bc15d22de860bd561f94` |
| Deployed runtime bytecode Keccak-256 | `0xe4ad785fafb43eac06afd7236ddf701d7b15f1fff4029a22c91ef7a6377b40c6` |
| Local handoff verification | Passed at 20 confirmations; independent follow-up passed at 99 confirmations |
| Sourcify verification | Exact creation and runtime match; match ID `42715122` |
| Published personal security review URL | `https://must-mohsin1.github.io/must-pirateship-audit/report.html` |
| Release criteria URL | `https://pirateship.must.company/mainnet-release-criteria.html` |
| Deployment transaction | `0x29c1ec7013fa8a953ce318f09e6bee9cc7b5b3b191c49e0885a961459091584e` |
| Contract address | `0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff` |
| Deployment block | `90639970` |
| Deadline | `1787256952` — 20 August 2026 at 20:15:52 UTC / 21 August 2026 at 01:15:52 PKT |
