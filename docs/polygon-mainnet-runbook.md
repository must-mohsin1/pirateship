# Polygon mainnet launch runbook

This runbook starts after the Polygon Amoy rehearsal. It deliberately separates preparation from deployment: no mainnet contract should be deployed and no real pledge should be accepted until every blocking gate is closed.

## Current decision: keep Amoy public

The landing page remains connected to Amoy contract `0x6bF097816997C242F3447A470d1cc3d170cbcB98`. Do not replace that address with a mainnet address until the production contract is audited, deployed, source-verified, and checked with the read-only steps below.

Polygon PoS mainnet uses chain ID `137` and native gas token `POL`. Use a dedicated authenticated RPC for production. Never paste a seed phrase or private key into this project, its environment files, Remix, a Slack message, or a support ticket.

## Gate 1: price and release promise

The minimum first pledge is immutable after deployment. KyungJu Lee, Lead of the AX Booster Team and AI Engineering, approved `300 POL` on 21 July 2026 as the intended mainnet constructor input, exactly `300000000000000000000` wei. Reconfirm the amount if the launch date changes materially because native-POL pricing is volatile. Polygon USDC remains deferred.

Before deployment, publish one stable HTTPS page that defines all of the following:

- what usable product must exist;
- what the supporter receives with the product key;
- the Product Hunt or production URL that counts as release evidence;
- the exact deadline and timezone;
- that approval is permanent and releases only that supporter's pledge;
- that an unapproved pledge becomes refundable after the deadline but still requires someone to submit the on-chain refund transaction.

The public criteria are prepared at `https://pirateship.must.company/mainnet-release-criteria.html`. That URL counts as published only after the page is merged, deployed, and reachable without authentication. Complete any additional legal review required by company policy before opening the campaign.

## Gate 2: audit and custody

Obtain an independent Solidity audit against the exact Git commit and compiler configuration intended for deployment: Solidity `0.8.30`, optimizer enabled with `200` runs, and EVM target `paris`. Give the reviewer [`security-audit-template.md`](security-audit-template.md) as a checklist. The template is not an audit and does not satisfy this gate.

The current contract makes the transaction sender the immutable owner. Therefore the final deployment transaction must originate from the reviewed owner address. A hardware wallet or multisig remains the recommended custody. The project owner selected a dedicated Trust Wallet EOA as an explicit exception for this launch. That exception is accepted only when `HOT_WALLET_RISK_ACCEPTED=yes` and `WALLET_RECOVERY_BACKUP_CONFIRMED=yes`; neither flag substitutes for an independent audit or permits recording a recovery phrase anywhere in the project.

The approved owner/deployer and beneficiary are both `0xcF9178cA7360066B25de9c142A4c155abf151D6f`. PolygonScan identified it as an EOA and showed `11.7 POL` after the funding transaction on 21 July 2026. Independently compare the address in Trust Wallet and PolygonScan, confirm Polygon PoS mainnet, record the offline backup procedure and internal approval policy for `markProductReleased`, and sign the final deployment only from this account.

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
- blocks Trust Wallet custody unless permanent hot-wallet risk and offline recovery backup are explicitly attested;
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

Deployment starts the immutable 30-day clock immediately. Schedule it only when the team, release page, monitoring, unlimited-license service, released product validation, and support coverage are ready.

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

Before the canary, deploy the integrated service with `.env.aws-mainnet.example`. `PRODUCT_KEY_MODE=generated` uses shared Redis for assignments, challenges, and rate limits and never opens SQLite. Generate independent encryption and generation secrets, keep them in the deployment secret manager and team recovery process, and test Redis backup/restore plus secret-fingerprint failure handling. The released product must validate the generated `PIRATE-POL-*` licenses.

Use a separate supporter wallet for one minimum pledge. Confirm the landing page shows the correct pledge and that administrators cannot withdraw it before that supporter approves. Do not mark the product released merely to test mainnet; the exact audited bytecode should already have completed the full lifecycle rehearsal on Amoy.

Finally, enable monitoring for RPC failure, contract events, Redis availability and backups, assignment counts, secret-fingerprint failures, and the deadline/refund queue. Publish the mainnet address only after the canary, source verification, and service checks are all green.
