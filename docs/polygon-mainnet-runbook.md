# Polygon mainnet launch runbook

This runbook starts after the Polygon Amoy rehearsal. It deliberately separates preparation from deployment: no mainnet contract should be deployed and no real pledge should be accepted until every blocking gate is closed.

## Current decision: keep Amoy public

The landing page remains connected to Amoy contract `0x6bF097816997C242F3447A470d1cc3d170cbcB98`. Do not replace that address with a mainnet address until the production contract is audited, deployed, source-verified, and checked with the read-only steps below.

Polygon PoS mainnet uses chain ID `137` and native gas token `POL`. Use a dedicated authenticated RPC for production. Never paste a seed phrase or private key into this project, its environment files, Remix, a Slack message, or a support ticket.

## Gate 1: price and release promise

The minimum first pledge is immutable after deployment. `250 POL` is still a proposal, not an approved price. At an indicative POL price of about `$0.084` on 17 July 2026, it is approximately `$21`; a `$25` pledge would be about `300 POL`, while a `$49` pledge would be about `585 POL`. Recheck the market price immediately before deployment because native-POL pricing is volatile. Polygon USDC remains deferred.

Before deployment, publish one stable HTTPS page that defines all of the following:

- what usable product must exist;
- what the supporter receives with the product key;
- the Product Hunt or production URL that counts as release evidence;
- the exact deadline and timezone;
- that approval is permanent and releases only that supporter's pledge;
- that an unapproved pledge becomes refundable after the deadline but still requires someone to submit the on-chain refund transaction.

Finance/legal must mark the price review complete only after agreeing on the POL amount and the user-facing promise.

## Gate 2: audit and custody

Obtain an independent Solidity audit against the exact Git commit and compiler configuration intended for deployment: Solidity `0.8.30`, optimizer enabled with `200` runs, and EVM target `paris`.

The current contract makes the transaction sender the immutable owner. Therefore the final deployment transaction must originate from the reviewed owner address. For one administrator, that can be a hardware-wallet address. For the requested multi-administrator model, use a reviewed multisig deployment path that makes the multisig itself `msg.sender`, or revise the constructor to accept an explicit owner address and send that revision back through audit. A normal Trust Wallet hot account is not sufficient custody for real customer funds.

The beneficiary can be a different reviewed hardware-wallet or multisig address. Record the owner, beneficiary, signer threshold, signer list, backup/recovery process, and the internal approval policy for `markProductReleased` before deployment.

## Gate 3: run the read-only preflight

Create the ignored local file and fill in only public addresses and review evidence:

```sh
cp .env.mainnet-preflight.example .env.mainnet-preflight
npm --prefix services/product-key install
npm --prefix services/product-key run preflight:mainnet
```

The preflight:

- verifies the RPC reports Polygon chain ID `137`;
- verifies the deployment wallet has some real POL for gas;
- checks whether the selected custody mode matches an EOA or contract address;
- converts the proposed pledge to its exact immutable wei value;
- compiles the checked-in source with the pinned compiler settings and prints a creation-bytecode hash;
- verifies that `SOURCE_COMMIT` matches the checked-out commit and that the deployment worktree has no local changes;
- refuses to report ready when audit or price approval is incomplete.

It is read-only. It never asks for a private key, never opens the wallet, and cannot deploy the contract.

## Gate 4: final deployment review

Two people should independently compare the preflight output against the approved deployment record:

1. Git commit and creation-bytecode hash.
2. Owner/deployer address.
3. Beneficiary address.
4. Minimum pledge in POL and wei.
5. Polygon chain ID `137`.
6. Dedicated RPC network.
7. Audit report and release-criteria URLs.

Only then prepare the wallet transaction. Confirm the wallet itself displays Polygon mainnet, the expected deploying account, and a nonzero real-POL gas fee. Do not deploy from this repository through a raw private key.

Deployment starts the immutable 30-day clock immediately. Schedule it only when the team, release page, monitoring, key inventory, and support coverage are ready.

## Gate 5: verify before publishing

After deployment, do not accept pledges yet. Record the transaction hash and deployment block, then verify the exact source and constructor arguments on PolygonScan. Read these values back from both the dedicated RPC and PolygonScan:

- `owner` equals the reviewed owner/deployer;
- `beneficiary` equals the reviewed treasury;
- `minimumPledge` equals the approved wei amount;
- `deadline` is exactly 30 days after the deployment timestamp;
- `phase()` is `Funding`;
- `productReleased` is `false`.

Update `CONTRACT_ADDRESS`, `VITE_CONTRACT_ADDRESS` if a deployment wrapper needs it, `FROM_BLOCK`, the product-key verifier, and `escrow-config.js` from the same deployment record. The frontend/service consistency check must pass before publishing.

## Gate 6: production canary

Use a separate supporter wallet for one minimum pledge. Confirm the landing page shows the correct pledge and that administrators cannot withdraw it before that supporter approves. Do not mark the product released merely to test mainnet; the exact audited bytecode should already have completed the full lifecycle rehearsal on Amoy.

Finally, enable monitoring for RPC failure, contract events, key inventory, database backups, and the deadline/refund queue. Publish the mainnet address only after the canary, source verification, and service checks are all green.
