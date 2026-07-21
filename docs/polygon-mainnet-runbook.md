# Polygon mainnet launch runbook

This runbook starts after the Polygon Amoy rehearsal. It deliberately separates preparation from deployment: no mainnet contract should be deployed and no real pledge should be accepted until every blocking gate is closed.

## Current state: mainnet deployed and verified

The mainnet escrow is deployed at `0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff`
in block `90639970`. Transaction
`0x29c1ec7013fa8a953ce318f09e6bee9cc7b5b3b191c49e0885a961459091584e`
passed the 20-confirmation controller check and a separate read-only RPC check.
Sourcify reports exact creation and runtime matches. The remaining work is the
production configuration deploy, service canary, and usable-product release.

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

## Gate 2: security review and custody

The deployed source received a published personal security review against the exact Git commit and compiler configuration: Solidity `0.8.30`, optimizer enabled with `200` runs, and EVM target `paris`. The reviewer of record is Mohsin Zahid, who is also part of the project; this is not an independent audit. Sourcify's exact creation/runtime match confirms that the published source corresponds to the deployed bytecode, but it does not prove the contract is secure. The project owner explicitly accepted proceeding with this residual risk; an independent Solidity audit remains a recommended follow-up.

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
- reads the contract source from the exact `SOURCE_COMMIT` Git object, then compiles it with the pinned settings and prints explicitly named Keccak-256 and SHA-256 fingerprints for both the bare creation bytecode and the full deployment initcode;
- constructs the full deployment initcode from the reviewed beneficiary and minimum pledge so either constructor input changes the deployment-control fingerprint;
- verifies that `SOURCE_COMMIT` matches the checked-out commit and that the deployment worktree has no local changes;
- refuses to report ready when audit or price approval is incomplete.

It is read-only. It never asks for a private key, never opens the wallet, and cannot deploy the contract.

## Gate 4: final deployment review

Two people should independently compare the preflight output against the approved deployment record:

1. Git commit, compiler settings, and full deployment-initcode Keccak-256 fingerprint. The bare creation-bytecode hash alone is insufficient because it does not include constructor arguments.
2. Owner/deployer address.
3. Beneficiary address.
4. Minimum pledge in POL and wei.
5. Polygon chain ID `137`.
6. Dedicated RPC network.
7. Audit report and release-criteria URLs.

Only then start the localhost-only deployment handoff:

```sh
npm --prefix services/product-key run deploy:mainnet:local
```

Open the freshly printed `http://localhost:<random-port>/` URL in the browser that has the Trust Wallet extension. Trust Wallet's Chrome permissions cover exact `localhost`, while the ephemeral port still creates a fresh origin and the controller rejects every other `Host` value. The page also refuses to operate if a service worker controls that origin. The tool reruns the complete preflight, refuses to start while any gate is blocked, serves no RPC credentials, prefers the EIP-6963 Trust Wallet provider, and accepts only Trust Wallet's explicit legacy provider as a compatibility fallback. It asks that wallet to send the exact reviewed deployment initcode. Confirm the wallet displays Polygon mainnet, the expected deploying account, zero transfer value, and a nonzero real-POL gas fee. The `300 POL` value is the immutable minimum pledge encoded in the contract, not POL sent by the deployment transaction. Never paste a recovery phrase or private key into the page, project, console, or terminal.

The local page requires the review acknowledgement and exact displayed confirmation phrase before it can call `eth_sendTransaction`. The wallet cannot self-verify success: the localhost controller separately uses the dedicated Polygon RPC, waits for 20 confirmations, compares the actual transaction input with the reviewed initcode, and reads back the owner, beneficiary, minimum pledge, exact deadline, phase, and release flag. A timeout or mismatch fails closed. Keep the independent PolygonScan checks below as a second verification channel.

Immediately before asking Trust Wallet to submit, the controller atomically creates the ignored repository-root file `.mainnet-deployment-attempt.json`; the page also records a secondary browser lock. The first transaction hash is persisted as soon as Trust Wallet returns it and can never be replaced by a later hash. Verification is permitted only for that exact hash. Any wallet/provider/RPC result—including a reported wallet rejection—keeps the durable lock and disables another controller attempt. Reconcile the saved journal, the deployer account nonce, Trust Wallet activity, and PolygonScan first. Remove the journal and browser lock only after two people record that no deployment transaction exists; never bypass either lock by changing the browser profile or moving the repository.

Deployment starts the immutable 30-day clock immediately. Schedule it only when the team, release page, monitoring, unlimited-license service, released product validation, and support coverage are ready.

## Gate 5: verify before publishing

After deployment, do not accept pledges yet. Copy the transaction hash, contract address, deployment block, and deadline printed by the local handoff into the deployment record. Then verify the exact source, transaction input, and constructor arguments through an independent RPC and a public source verifier. For this deployment, Sourcify recorded exact creation and runtime matches; its automatic Etherscan forwarding hit the explorer's shared daily submission limit, so retry the PolygonScan badge separately. Read these values back from the independent RPC:

- `owner` equals the reviewed owner/deployer;
- `beneficiary` equals the reviewed treasury;
- `minimumPledge` equals the approved wei amount;
- `deadline` is exactly 30 days after the deployment timestamp;
- `phase()` is `Funding`;
- `productReleased` is `false`.

Update `CONTRACT_ADDRESS`, `VITE_CONTRACT_ADDRESS` if a deployment wrapper needs it, `FROM_BLOCK`, the product-key verifier, and `escrow-config.js` from the same deployment record. The frontend/service consistency check must pass before publishing.

## Gate 6: production canary

Before the canary, deploy the integrated service with `.env.aws-mainnet.example`. `PRODUCT_KEY_MODE=generated` uses shared Redis for assignments, challenges, and rate limits and never opens SQLite; the service now refuses to start on chain ID `137` in any other mode. DevOps must provide a non-cluster primary/write endpoint reachable from ECS with TLS, authentication, and backups. Inject its complete `rediss://` connection URL as `REDIS_URL`, keep `REDIS_CLUSTER_MODE=false`, and inject the independent encryption and generation secrets through the deployment environment. Do not configure the Upstash REST variables on AWS or place secrets in plaintext task configuration. Keep the independent values in the team recovery process, and test Redis backup/restore plus secret-fingerprint failure handling. The released product must validate the generated `PIRATE-POL-*` licenses.

Use a separate supporter wallet for one minimum pledge. Confirm the landing page shows the correct pledge and that administrators cannot withdraw it before that supporter approves. Do not mark the product released merely to test mainnet; the exact audited bytecode should already have completed the full lifecycle rehearsal on Amoy.

Finally, enable monitoring for RPC failure, contract events, Redis availability and backups, assignment counts, secret-fingerprint failures, and the deadline/refund queue. Publish the mainnet address only after the canary, source verification, and service checks are all green.
