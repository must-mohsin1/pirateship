# Pirate Network refundable pre-order

This repository contains the Pirate Network essay landing page plus a 30-day refundable pre-order flow. The checked-in public configuration targets the verified Polygon PoS mainnet escrow at `0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff`; the older Amoy setup is retained only as a historical rehearsal and test fixture.

## What was added

- `pirate-network-blog.html` — the existing essay with the pre-order section appended at the bottom.
- `escrow.js` — dependency-free Polygon wallet, contract read, owner release, pre-order, approval, refund, and product-key interactions.
- `escrow-config.js` — public frontend configuration.
- `contracts/RefundableProductEscrow.sol` — the tested 30-day escrow contract.
- `services/product-key/` — the signed-wallet product-key API, Amoy inventory stores, mainnet unlimited Redis licenses, and automated tests.
- `api/` — Vercel Function entry points for health, wallet challenges, key redemption, and private inventory administration.
- `tokens.css` — shared design tokens used by the page.
- `mainnet-release-criteria.html` — the public promise supporters must review before a real-money pledge or approval.

Release notes are tracked in [`CHANGELOG.md`](CHANGELOG.md). The remaining real-money launch blockers are tracked in [`TODOS.md`](TODOS.md), and the current checkpoint version is stored in [`VERSION`](VERSION).

The step-by-step production gates are documented in [`docs/polygon-mainnet-runbook.md`](docs/polygon-mainnet-runbook.md). The included mainnet preflight is read-only: it validates public addresses, chain ID, review evidence, custody type, gas balance, compiler settings, and the immutable pledge conversion without accepting a private key or sending a transaction.

The mainnet criteria are published at <https://pirateship.must.company/mainnet-release-criteria.html>. The exact deployment source has a published personal security review at <https://must-mohsin1.github.io/must-pirateship-audit/report.html> and exact creation/runtime matches on [Sourcify](https://repo.sourcify.dev/137/0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff). Sourcify verification proves source-to-bytecode correspondence; it is not a substitute for an independent security audit.

## Historical Amoy rehearsal

The repository retains the Amoy backend environment and automated lifecycle tests as regression fixtures. The checked-in frontend now points to mainnet, so this historical server command is not a production or end-to-end launch configuration.

Prerequisites: Node.js `22.5.0` or newer and a browser profile with a Polygon-compatible wallet such as Trust Wallet.

```sh
cp .env.amoy.example .env.amoy
# Set ADMIN_TOKEN in .env.amoy to at least 32 random characters.
npm --prefix services/product-key install
npm --prefix services/product-key run check
npm --prefix services/product-key test
npm --prefix services/product-key run serve:amoy
```

Local environment files, SQLite databases, `keys.json`, and `product-keys*.json` are ignored; administrator tokens, wallet private keys, and real product-key inventory must remain outside the repository.

## User flow

1. A supporter connects a Polygon-compatible wallet and places a first pre-order of at least the immutable `300 POL` mainnet minimum. Later top-ups may be any positive amount while funding remains open. The older Amoy rehearsal used `0.01` test POL.
2. The team publishes the product and records a public release-proof URL before the contract deadline. The Product Hunt launch URL can be used as that public evidence when it points to the usable release.
3. Each supporter independently approves or does not approve. Approval releases only that supporter’s pledge and makes the wallet eligible for a product key.
4. Every unapproved pledge becomes refundable after the deadline.

The Amoy rehearsal uses finite off-chain inventory. Mainnet uses `PRODUCT_KEY_MODE=generated`: Redis atomically records one stable, non-guessable `PIRATE-POL-*` license for every approved wallet, so issuance cannot run out. The released product must still validate those generated licenses before the campaign can accept real funds.

Refund eligibility activates automatically, but a blockchain contract cannot initiate its own transaction. The supporter or a refund bot must submit the refund transaction; the contract always sends the money to the original supporter wallet.

## Production setup

### 1. Verified contract deployment

`contracts/RefundableProductEscrow.sol` is deployed on Polygon PoS mainnet. The deployment transaction made its sender the immutable owner, while the constructor beneficiary is the only wallet allowed to withdraw approved funds. The immutable production minimum is `300 POL` (`300000000000000000000` wei), and the 30-day deadline is 20 August 2026 at 20:15:52 UTC.

The intended owner/deployer and beneficiary are both `0xcF9178cA7360066B25de9c142A4c155abf151D6f`. The current verification state and final evidence slots are recorded in [`docs/polygon-mainnet-deployment-record.md`](docs/polygon-mainnet-deployment-record.md). The project owner selected this funded Trust Wallet EOA as a permanent single-owner exception; preflight requires explicit hot-wallet risk and offline recovery-backup attestations and never accepts the recovery phrase.

The preflight and deployment handoff remain in the repository for reproducibility and audit evidence. They must not be used to deploy a second production contract. To reproduce the read-only preflight, copy `.env.mainnet-preflight.example` to the ignored `.env.mainnet-preflight`, complete the public review fields, and run:

```sh
npm --prefix services/product-key run preflight:mainnet
```

This check reports `READY_FOR_MANUAL_DEPLOYMENT_REVIEW` when its historical inputs are still reproducible. It cannot deploy the contract.

The preflight prints separate Keccak-256 and SHA-256 values for the bare creation bytecode and for the full deployment initcode. Review the full deployment-initcode fingerprint: unlike the bare bytecode hash, it also commits to the approved beneficiary and immutable `300 POL` minimum pledge.

The completed localhost-only Trust Wallet handoff recompiled the contract from the exact `SOURCE_COMMIT` Git object, preferred the EIP-6963 provider identified as Trust Wallet, and accepted only Trust Wallet's explicit legacy provider as a compatibility fallback. The exact `localhost` hostname matches Trust Wallet's extension permissions; strict Host validation prevents DNS rebinding. A separate server-side connection to Polygon RPC waited for 20 confirmations, verified the first recorded transaction hash and exact mined input, and read back the immutable on-chain terms. The handoff never accepted a recovery phrase or raw private key.

The minimum cannot be changed after deployment. The page reads the exact value from the contract instead of trusting a frontend-only setting. Polygon USDC support is intentionally deferred; this version accepts native POL only.

### 2. Configure the landing page

`escrow-config.js` points to the source-verified Polygon mainnet escrow
`0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff` on chain `137`, deployed in block
`90639970`. The deployment transaction is
`0x29c1ec7013fa8a953ce318f09e6bee9cc7b5b3b191c49e0885a961459091584e`,
and the immutable deadline is 20 August 2026 at 20:15:52 UTC.

```js
globalThis.PIRATE_ESCROW_CONFIG = Object.freeze({
  contractAddress: "0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff",
  chainId: "0x89",
  chainName: "Polygon Mainnet",
  nativeSymbol: "POL",
  rpcUrls: ["https://polygon.drpc.org"],
  explorerUrl: "https://polygonscan.com",
  keyApiBase: "",
});
```

The public dRPC endpoint is the launch fallback. Replace it with a dedicated authenticated production RPC when available. The address shown on the page and the address used by the product-key service must remain identical.

### 3. Serve the product-key API

Product keys and generation secrets must never be embedded in the public frontend. The repository supports these deployment shapes:

- The integrated Node server serves the page plus `/api/*` from one process. Amoy compatibility mode uses SQLite; mainnet generated mode uses a standard Redis primary endpoint and does not open SQLite.
- The root `api/` routes are Vercel Functions. They use Upstash Redis because a Vercel Function has a read-only filesystem apart from temporary scratch space and may scale to multiple instances.

For a local Docker run:

```sh
cp .env.docker.example .env.docker
# Set ADMIN_TOKEN in .env.docker to the output of: openssl rand -hex 32
docker build -t must-pirateship .
docker run --rm --name must-pirateship \
  --env-file .env.docker \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -p 127.0.0.1:4173:4173 \
  -v must-pirateship-data:/data \
  must-pirateship
```

Open <http://127.0.0.1:4173/>. The service creates and migrates `/data/product-keys.db` automatically, so there is no database dump to import or commit. The database contains private inventory and wallet assignments; keep the volume encrypted and backed up.

For the current Vercel deployment:

1. In the Vercel project, open **Storage**, install the **Upstash Redis** Marketplace integration, create a database near the Function region, and connect it to this project.
2. Copy every variable from `.env.vercel.example` into the Vercel Production environment. The integration supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Generate `ADMIN_TOKEN` with `openssl rand -base64 48` and `PRODUCT_KEY_ENCRYPTION_KEY` with `openssl rand -base64 32`. Store both only in Vercel environment variables and the team password manager. The service fingerprints the encryption key per Redis namespace and fails health checks before mutating inventory if the key changes.
4. Use a dedicated authenticated Polygon RPC. Keep `CONTRACT_ADDRESS` and `EXPECTED_CHAIN_ID` identical to `escrow-config.js`, and keep `PUBLIC_ORIGIN` exactly `https://pirateship-must.vercel.app` for this deployment. Health checks fail if the RPC reports a different chain.
5. Redeploy, then confirm `GET https://pirateship-must.vercel.app/api/health` returns `{ "ok": true }`.

The Redis adapter stores wallet challenges with a TTL, applies a shared per-client rate limit, and encrypts stored assignments with AES-256-GCM. The integrated AWS server accepts a standard `redis://`/`rediss://` connection URL; production requires `rediss://` plus authentication. Vercel continues to use Upstash REST. Configure exactly one transport. Inventory mode atomically consumes imported keys and quarantines corrupt unassigned ciphertext. Generated mode uses HMAC-SHA-256 with a separate 32-byte generation secret, the chain ID, contract address, and supporter wallet to produce a stable 128-bit license identifier. It records the encrypted assignment atomically, fingerprints both secrets and the deployment context, rejects secret or contract drift, refuses finite inventory in the generated namespace, and disables the inventory-import API. Leave `PRODUCT_KEY_REDIS_PREFIX` blank to use the contract-address default, or use a unique value for every chain and escrow deployment.

The integrated long-running server keeps `keyApiBase` empty as well. When it is deployed behind HTTPS, set `TRUST_PROXY=true` and block direct access to the Node port. Its rate limiter uses the last address in `X-Forwarded-For`, which matches an AWS Application Load Balancer directly appending the real client address. A separate API origin requires one exact `CORS_ORIGIN` and the matching HTTPS `keyApiBase`; never allow `*` for wallet-verification endpoints.

The API uses JSON and returns errors as `{ "error": "..." }`:

- `GET /api/live` returns `{ "ok": true }` when the integrated Node process is running and remains the Docker image's liveness endpoint.
- `GET /api/health` separates the existing AWS probes without changing CDK: a loopback request from the ECS container is treated as liveness, while a remote request from the load balancer checks the configured Polygon contract plus the active product-key store. Inventory mode performs a rolled-back SQLite write; generated mode checks Redis connectivity, namespace isolation, and both secret fingerprints. A dependency or configuration failure returns HTTP `500` with `{ "error": "The product-key service could not complete the request. Try again shortly." }`.
- `POST /api/auth/challenge` accepts `{ "address": "0x..." }` and returns `{ "challengeId", "address", "message", "expiresAt" }`. The short-lived message is what the wallet signs. Wallet-verification requests are rate limited.
- `POST /api/keys/redeem` accepts `{ "challengeId": "...", "address": "0x...", "signature": "0x..." }`. It returns `{ "productKey": "...", "existing": false }` for a new assignment or `existing: true` for the stable key already assigned to that approved wallet.
- `POST /api/admin/keys` accepts finite inventory only in inventory mode. Generated mainnet mode authenticates the request and returns HTTP `409` because unlimited licenses require no uploads.

Runtime configuration is shared unless noted. Generated mode uses one Redis transport plus the encryption, generation, Redis-prefix, Redis-timeout, and rate-limit variables. `REDIS_URL` is for the integrated Node server; the Upstash REST variables are for Vercel. `CORS_ORIGIN`, `PORT`, `HOST`, `DATABASE_PATH`, and `TRUST_PROXY` apply to the integrated Node server; `DATABASE_PATH` is ignored in generated mode.

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Dedicated Polygon JSON-RPC endpoint used for entitlement checks. |
| `CONTRACT_ADDRESS` | Exact deployed escrow address; startup fails if it differs from the public browser config. |
| `EXPECTED_CHAIN_ID` | Decimal Polygon chain ID; `80002` for Amoy and `137` for mainnet. Startup and health checks fail on a mismatch. |
| `PUBLIC_ORIGIN` | Public origin used in signed wallet challenges. |
| `CORS_ORIGIN` | Optional single allowed browser origin when the API is hosted separately. |
| `ADMIN_TOKEN` | Private inventory-administration token with at least 32 random characters. |
| `PRODUCT_KEY_MODE` | `inventory` for the Amoy compatibility flow or `generated` for unlimited mainnet licenses. |
| `REDIS_URL` | Standard Redis connection URL for the integrated server. Production requires a TLS `rediss://` URL containing authentication; inject the complete value as a secret. |
| `REDIS_CLUSTER_MODE` | Must be `false`. The atomic Lua operations require a non-cluster primary/write endpoint. |
| `UPSTASH_REDIS_REST_URL` | Server-only Upstash REST endpoint injected by the Vercel integration. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only Upstash standard token; never expose it in browser code. |
| `PRODUCT_KEY_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key used to encrypt Redis inventory or assignments. |
| `PRODUCT_KEY_GENERATION_KEY` | Separate base64-encoded 32-byte HMAC key required by generated mode. Losing or changing it invalidates deterministic regeneration, so back it up securely. |
| `PRODUCT_KEY_LICENSE_PREFIX` | Public display prefix for generated licenses; defaults to `PIRATE-POL`. |
| `PRODUCT_KEY_REDIS_PREFIX` | Environment/contract-specific Redis namespace. |
| `REDIS_TIMEOUT_MS` | Upstash request timeout, or standard Redis connection/socket inactivity and graceful-shutdown timeout; defaults to `5000`. |
| `RPC_TIMEOUT_MS` | Timeout for an upstream Polygon verification request; defaults to `10000`. |
| `VERIFICATION_MAX_CONCURRENT` | Maximum simultaneous on-chain entitlement checks; defaults to `8`. |
| `VERIFICATION_MAX_QUEUED` | Maximum checks waiting for capacity; defaults to `32`. |
| `HEALTH_CHECK_TTL_MS` | Cache duration for successful storage/RPC readiness checks; defaults to `10000`. |
| `RATE_LIMIT_WINDOW_MS` | Shared Redis rate-limit window; defaults to ten minutes. |
| `RATE_LIMIT_MAX` | Wallet-verification requests allowed per client/window; defaults to `60`. |
| `PORT` | Local HTTP listen port; defaults to `4173`. |
| `HOST` | Local listen address; defaults to `127.0.0.1`. |
| `DATABASE_PATH` | Persistent SQLite product-key database path. |
| `TRUST_PROXY` | Must be `true` for the documented HTTPS reverse-proxy deployment. |

Prepare a private `keys.json` outside the repository, then load it from an administrator machine without placing the token directly in shell history:

```sh
read -rs ADMIN_TOKEN
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_TOKEN" |
  curl --fail-with-body --config - \
    --header 'Content-Type: application/json' \
    --data-binary @keys.json \
    https://YOUR_HOST/api/admin/keys
unset ADMIN_TOKEN
```

The integrated inventory process bounds its local rate-limit and challenge stores. Vercel and generated mainnet mode use shared Redis TTL state and cross-instance assignment coordination. Both shapes limit concurrent on-chain entitlement checks per process or Function instance, queue only a small amount of verification work, and apply an RPC timeout; configure an aggregate quota with the RPC provider as the service scales out. Successful readiness checks are cached for `HEALTH_CHECK_TTL_MS`, and failures are cached for up to two seconds to limit repeated dependency calls during an outage. Protect the public readiness route with host-level request-rate controls as well, because per-instance caching cannot prevent horizontal scale-out abuse. Enable Redis backups, assignment alerts, and a tested recovery procedure before the mainnet launch.

### AWS container deployment

The root `Dockerfile` packages the landing page and product-key service into one non-root Node.js image. The AWS CDK infrastructure and commands are documented in [`cdk/README.md`](cdk/README.md). Use `.env.docker.example` for the local Amoy check. `.env.aws.example` remains the AWS Amoy rehearsal template; `.env.aws-mainnet.example` contains the no-CDK generated-Redis mainnet settings. Both examples intentionally contain no credential or secret. Before publishing the image to Amazon ECR, verify both `curl --fail http://127.0.0.1:4173/api/live` and a remote readiness request to `/api/health` return `{"ok":true}`. Do not add a populated environment file or secret to the image or repository.

Recommended first AWS deployment:

1. Push the tested image to a private Amazon ECR repository.
2. Create an ECS Fargate task exposing container port `4173`. Use `.env.aws-mainnet.example` as the runtime variable list and inject every blank secret value through the deployment secret manager.
3. For the Amoy rehearsal only, mount an encrypted Amazon EFS access point at `/data`. Configure its POSIX owner as UID/GID `1000`, permissions `0700`, and enable transit encryption so the image's non-root `node` user can create the rollback-journal SQLite database. Before the first storage-mode deployment, scale the service to zero, use a one-off maintenance task to run `PRAGMA wal_checkpoint(TRUNCATE)` and `PRAGMA integrity_check`, stop that task, and take an EFS backup. Restore the backup to an isolated path and repeat the integrity check before deploying. Never copy a live database or delete its sidecars.
4. Put the task in private subnets behind an Application Load Balancer with an ACM HTTPS certificate. Allow task port `4173` only from the load balancer security group. Set `PUBLIC_ORIGIN` to the final `https://` host and `TRUST_PROXY=true`.
5. Keep the existing CDK probes unchanged. The ECS task calls `GET /api/health` over loopback, which the integrated server treats as liveness; the load balancer calls the same path remotely and receives full storage/RPC readiness. The Docker image's direct health check remains `GET /api/live`. This removes a task from traffic during a dependency outage without restarting the otherwise healthy process or requiring a platform-infrastructure change.
6. Keep the service at exactly one desired task for this SQLite/process-local implementation. Set the rolling deployment limits to minimum healthy `0%` and maximum `100%` so old and new tasks do not overlap; this trades a brief deployment interruption for single-writer safety. Do not enable horizontal scaling until challenges, rate limits, and key assignment use shared production storage.
7. Enable EFS backups, CloudWatch logs, and alarms for unhealthy targets and HTTP `5xx` responses before loading real product keys.

The checked-in `.env.aws.example` remains an historical Polygon Amoy fixture. Production uses `.env.aws-mainnet.example`: generated mode moves assignments, challenges, and rate limits to shared Redis without modifying CDK or opening SQLite. DevOps supplies a TLS/authenticated primary write endpoint with cluster mode disabled and backups enabled, and injects `REDIS_URL` plus the other blank runtime values through the deployment environment. Keep credentials and product-key secrets in the deployment secret manager rather than plaintext task environment or a committed environment file. The application team owns the independent administrator, encryption, and generation secrets and the final contract-specific namespace. Never reuse the rehearsal administrator token, Redis namespace, or secret.

### 4. Publish the release

Before the deadline, the contract owner connects the owner wallet and uses the owner-only release panel to call `markProductReleased(proofURI)` with a stable HTTPS URL for the usable production release. The panel is hidden from non-owner wallets and uses a normal wallet transaction—no private key is entered into the site. Recording a marketing post alone does not approve anyone’s pledge; every supporter still makes an individual decision.

### 5. Process unresolved refunds

Supporters can always call `claimRefund()` from the page after expiry. The optional refund processor can call `processRefund(supporter)` for unapproved wallets. The processor pays gas but cannot redirect the refund.

The beneficiary can separately call `withdrawApprovedFunds()` to withdraw only the pledges that supporters explicitly approved. Unapproved pledges never enter the beneficiary’s withdrawable balance.

## Mainnet safety checklist

- Link the published personal security review, disclose that it is not independent assurance, and retain an independent Solidity audit as a follow-up risk-reduction item.
- Link the exact Sourcify creation/runtime match and retry PolygonScan source publication if its shared daily submission limit delayed the explorer badge.
- Prefer a multisig or hardware wallet for owner and beneficiary roles. If the approved Trust Wallet exception is used, document the permanent single-owner risk and confirm an offline recovery backup without exposing it.
- Keep deployer keys, administrator tokens, RPC credentials, and product keys out of this repository.
- Publish a precise definition of “released” before accepting pre-orders.
- Explain that approval permanently gives up the refund for that pledge.
- Back up Redis and both product-key secrets, and test restoration before accepting funds.

This implementation is not a security audit or legal opinion.

The repository release uses the four-part checkpoint version in `VERSION`; the private Node service keeps the npm-compatible package version `0.1.0`.
