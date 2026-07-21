# Pirate Network refundable pre-order

This repository contains the Pirate Network essay landing page plus a 30-day refundable pre-order flow. The checked-in public configuration currently targets the Polygon Amoy rehearsal; mainnet remains a later audited deployment.

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

The prepared mainnet criteria will be published at <https://pirateship.must.company/mainnet-release-criteria.html>. The independent audit is still outstanding; [`docs/security-audit-template.md`](docs/security-audit-template.md) is only a reviewer checklist and must not be represented as an audit report.

## Resume the Amoy checkpoint

The repository now contains the complete tested flow. The integrated Node server serves both the landing page and `/api/*` from one origin, so product-key requests do not depend on development-only CORS configuration.

Prerequisites: Node.js `22.5.0` or newer and a browser profile with a Polygon-compatible wallet such as Trust Wallet.

```sh
cp .env.amoy.example .env.amoy
# Set ADMIN_TOKEN in .env.amoy to at least 32 random characters.
npm --prefix services/product-key install
npm --prefix services/product-key run check
npm --prefix services/product-key test
npm --prefix services/product-key run serve:amoy
```

Open <http://127.0.0.1:4173/pirate-network-blog.html#preorder> in the browser profile containing Trust Wallet. The checked-in Amoy address is public configuration. Local environment files, SQLite databases, `keys.json`, and `product-keys*.json` are ignored; administrator tokens, wallet private keys, and real product-key inventory must remain outside the repository.

## User flow

1. A supporter connects a Polygon-compatible wallet and places a first pre-order of at least the immutable on-chain minimum. The current Amoy rehearsal uses `0.01` test POL; the approved mainnet input is `300 POL`. Later top-ups may be any positive amount while funding remains open.
2. The team publishes the product and records a public release-proof URL before the contract deadline. The Product Hunt launch URL can be used as that public evidence when it points to the usable release.
3. Each supporter independently approves or does not approve. Approval releases only that supporter’s pledge and makes the wallet eligible for a product key.
4. Every unapproved pledge becomes refundable after the deadline.

The Amoy rehearsal uses finite off-chain inventory. Mainnet uses `PRODUCT_KEY_MODE=generated`: Redis atomically records one stable, non-guessable `PIRATE-POL-*` license for every approved wallet, so issuance cannot run out. The released product must still validate those generated licenses before the campaign can accept real funds.

Refund eligibility activates automatically, but a blockchain contract cannot initiate its own transaction. The supporter or a refund bot must submit the refund transaction; the contract always sends the money to the original supporter wallet.

## Production setup

### 1. Deploy the contract

Deploy `contracts/RefundableProductEscrow.sol` to Polygon PoS mainnet only after the intended owner, beneficiary, and minimum pledge have passed an independent security review. The deploying wallet becomes the immutable owner, while the constructor beneficiary is the only wallet allowed to withdraw approved funds. Deployment starts the immutable 30-day clock and spends real POL. The existing `0.01` POL deployment is an Amoy rehearsal only; the approved production constructor input is `300 POL` (`300000000000000000000` wei), subject to the documented finance/legal sign-off.

The intended owner/deployer and beneficiary are both `0xcF9178cA7360066B25de9c142A4c155abf151D6f`. The current verification state and final evidence slots are recorded in [`docs/polygon-mainnet-deployment-record.md`](docs/polygon-mainnet-deployment-record.md). The project owner selected this funded Trust Wallet EOA as a permanent single-owner exception; preflight requires explicit hot-wallet risk and offline recovery-backup attestations and never accepts the recovery phrase.

Before preparing any deployment transaction, copy `.env.mainnet-preflight.example` to the ignored `.env.mainnet-preflight`, complete the public review fields, and run:

```sh
npm --prefix services/product-key run preflight:mainnet
```

This check must report `READY_FOR_MANUAL_DEPLOYMENT_REVIEW`. It cannot deploy the contract. Follow the complete runbook before switching the public configuration away from Amoy.

The minimum cannot be changed after deployment. The page reads the exact value from the contract instead of trusting a frontend-only setting. Polygon USDC support is intentionally deferred; this version accepts native POL only.

### 2. Configure the landing page

`escrow-config.js` currently points to the verified Amoy rehearsal contract `0x6bF097816997C242F3447A470d1cc3d170cbcB98` on chain `80002`, deployed at block `42475668`. For the later audited mainnet deployment, replace it with:

```js
globalThis.PIRATE_ESCROW_CONFIG = Object.freeze({
  contractAddress: "0xYOUR_DEPLOYED_POLYGON_ADDRESS",
  chainId: "0x89",
  chainName: "Polygon Mainnet",
  nativeSymbol: "POL",
  rpcUrls: ["https://YOUR_PRODUCTION_RPC"],
  explorerUrl: "https://polygonscan.com",
  keyApiBase: "",
});
```

Use a dedicated authenticated production RPC rather than depending on the public default. The address shown on the page and the address used by the product-key service must be identical.

### 3. Serve the product-key API

Product keys and generation secrets must never be embedded in the public frontend. The repository supports these deployment shapes:

- The integrated Node server serves the page plus `/api/*` from one process. Amoy compatibility mode uses SQLite; mainnet generated mode uses shared Redis and does not open SQLite.
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

The Redis adapter stores wallet challenges with a TTL, applies a shared per-client rate limit, and encrypts stored assignments with AES-256-GCM. Inventory mode atomically consumes imported keys and quarantines corrupt unassigned ciphertext. Generated mode uses HMAC-SHA-256 with a separate 32-byte generation secret, the chain ID, contract address, and supporter wallet to produce a stable 128-bit license identifier. It records the encrypted assignment atomically, fingerprints both secrets and the deployment context, rejects secret or contract drift, refuses finite inventory in the generated namespace, and disables the inventory-import API. Leave `PRODUCT_KEY_REDIS_PREFIX` blank to use the contract-address default, or use a unique value for every chain and escrow deployment.

The integrated long-running server keeps `keyApiBase` empty as well. When it is deployed behind HTTPS, set `TRUST_PROXY=true` and block direct access to the Node port. Its rate limiter uses the last address in `X-Forwarded-For`, which matches an AWS Application Load Balancer directly appending the real client address. A separate API origin requires one exact `CORS_ORIGIN` and the matching HTTPS `keyApiBase`; never allow `*` for wallet-verification endpoints.

The API uses JSON and returns errors as `{ "error": "..." }`:

- `GET /api/live` returns `{ "ok": true }` when the integrated Node process is running and remains the Docker image's liveness endpoint.
- `GET /api/health` separates the existing AWS probes without changing CDK: a loopback request from the ECS container is treated as liveness, while a remote request from the load balancer checks the configured Polygon contract plus the active product-key store. Inventory mode performs a rolled-back SQLite write; generated mode checks Redis connectivity, namespace isolation, and both secret fingerprints. A dependency or configuration failure returns HTTP `500` with `{ "error": "The product-key service could not complete the request. Try again shortly." }`.
- `POST /api/auth/challenge` accepts `{ "address": "0x..." }` and returns `{ "challengeId", "address", "message", "expiresAt" }`. The short-lived message is what the wallet signs. Wallet-verification requests are rate limited.
- `POST /api/keys/redeem` accepts `{ "challengeId": "...", "address": "0x...", "signature": "0x..." }`. It returns `{ "productKey": "...", "existing": false }` for a new assignment or `existing: true` for the stable key already assigned to that approved wallet.
- `POST /api/admin/keys` accepts finite inventory only in inventory mode. Generated mainnet mode authenticates the request and returns HTTP `409` because unlimited licenses require no uploads.

Runtime configuration is shared unless noted. Generated mode uses the Upstash, Redis-encryption, generation, Redis-prefix, Redis-timeout, and rate-limit variables in both Vercel and the integrated Node server. `CORS_ORIGIN`, `PORT`, `HOST`, `DATABASE_PATH`, and `TRUST_PROXY` apply to the integrated Node server; `DATABASE_PATH` is ignored in generated mode.

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Dedicated Polygon JSON-RPC endpoint used for entitlement checks. |
| `CONTRACT_ADDRESS` | Exact deployed escrow address; startup fails if it differs from the public browser config. |
| `EXPECTED_CHAIN_ID` | Decimal Polygon chain ID; `80002` for Amoy and `137` for mainnet. Startup and health checks fail on a mismatch. |
| `PUBLIC_ORIGIN` | Public origin used in signed wallet challenges. |
| `CORS_ORIGIN` | Optional single allowed browser origin when the API is hosted separately. |
| `ADMIN_TOKEN` | Private inventory-administration token with at least 32 random characters. |
| `PRODUCT_KEY_MODE` | `inventory` for the Amoy compatibility flow or `generated` for unlimited mainnet licenses. |
| `UPSTASH_REDIS_REST_URL` | Server-only Upstash REST endpoint injected by the Vercel integration. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only Upstash standard token; never expose it in browser code. |
| `PRODUCT_KEY_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key used to encrypt Redis inventory or assignments. |
| `PRODUCT_KEY_GENERATION_KEY` | Separate base64-encoded 32-byte HMAC key required by generated mode. Losing or changing it invalidates deterministic regeneration, so back it up securely. |
| `PRODUCT_KEY_LICENSE_PREFIX` | Public display prefix for generated licenses; defaults to `PIRATE-POL`. |
| `PRODUCT_KEY_REDIS_PREFIX` | Environment/contract-specific Redis namespace. |
| `REDIS_TIMEOUT_MS` | Maximum duration of each Upstash request; defaults to `5000`. |
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
2. Create an ECS Fargate task exposing container port `4173`. Inject `RPC_URL` and `ADMIN_TOKEN` from AWS Secrets Manager; set the other values from `.env.aws.example` in the task definition.
3. For the Amoy rehearsal only, mount an encrypted Amazon EFS access point at `/data`. Configure its POSIX owner as UID/GID `1000`, permissions `0700`, and enable transit encryption so the image's non-root `node` user can create the rollback-journal SQLite database. Before the first storage-mode deployment, scale the service to zero, use a one-off maintenance task to run `PRAGMA wal_checkpoint(TRUNCATE)` and `PRAGMA integrity_check`, stop that task, and take an EFS backup. Restore the backup to an isolated path and repeat the integrity check before deploying. Never copy a live database or delete its sidecars.
4. Put the task in private subnets behind an Application Load Balancer with an ACM HTTPS certificate. Allow task port `4173` only from the load balancer security group. Set `PUBLIC_ORIGIN` to the final `https://` host and `TRUST_PROXY=true`.
5. Keep the existing CDK probes unchanged. The ECS task calls `GET /api/health` over loopback, which the integrated server treats as liveness; the load balancer calls the same path remotely and receives full storage/RPC readiness. The Docker image's direct health check remains `GET /api/live`. This removes a task from traffic during a dependency outage without restarting the otherwise healthy process or requiring a platform-infrastructure change.
6. Keep the service at exactly one desired task for this SQLite/process-local implementation. Set the rolling deployment limits to minimum healthy `0%` and maximum `100%` so old and new tasks do not overlap; this trades a brief deployment interruption for single-writer safety. Do not enable horizontal scaling until challenges, rate limits, and key assignment use shared production storage.
7. Enable EFS backups, CloudWatch logs, and alarms for unhealthy targets and HTTP `5xx` responses before loading real product keys.

The checked-in `.env.aws.example` still targets Polygon Amoy. For mainnet, use `.env.aws-mainnet.example`: generated mode moves assignments, challenges, and rate limits to shared Redis without modifying CDK or opening SQLite. DevOps must inject independent encryption and generation secrets, configure Redis backup/restore, and use the final contract-specific namespace. After the audited contract is deployed, update `escrow-config.js`, `CONTRACT_ADDRESS`, and `EXPECTED_CHAIN_ID=137` together and rebuild the image. Never reuse the rehearsal administrator token, Redis namespace, or secret.

### 4. Publish the release

Before the deadline, the contract owner connects the owner wallet and uses the owner-only release panel to call `markProductReleased(proofURI)` with a stable HTTPS URL for the usable production release. The panel is hidden from non-owner wallets and uses a normal wallet transaction—no private key is entered into the site. Recording a marketing post alone does not approve anyone’s pledge; every supporter still makes an individual decision.

### 5. Process unresolved refunds

Supporters can always call `claimRefund()` from the page after expiry. The optional refund processor can call `processRefund(supporter)` for unapproved wallets. The processor pays gas but cannot redirect the refund.

The beneficiary can separately call `withdrawApprovedFunds()` to withdraw only the pledges that supporters explicitly approved. Unapproved pledges never enter the beneficiary’s withdrawable balance.

## Mainnet safety checklist

- Obtain an independent Solidity security audit before accepting funds.
- Verify the exact contract source on PolygonScan and link the verified address.
- Prefer a multisig or hardware wallet for owner and beneficiary roles. If the approved Trust Wallet exception is used, document the permanent single-owner risk and confirm an offline recovery backup without exposing it.
- Keep deployer keys, administrator tokens, RPC credentials, and product keys out of this repository.
- Publish a precise definition of “released” before accepting pre-orders.
- Explain that approval permanently gives up the refund for that pledge.
- Back up Redis and both product-key secrets, and test restoration before accepting funds.

This implementation is not a security audit or legal opinion.

The repository release uses the four-part checkpoint version in `VERSION`; the private Node service keeps the npm-compatible package version `0.1.0`.
