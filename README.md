# Pirate Network refundable pre-order

This repository contains the Pirate Network essay landing page plus a 30-day refundable pre-order flow. The checked-in public configuration currently targets the Polygon Amoy rehearsal; mainnet remains a later audited deployment.

## What was added

- `pirate-network-blog.html` — the existing essay with the pre-order section appended at the bottom.
- `escrow.js` — dependency-free Polygon wallet, contract read, owner release, pre-order, approval, refund, and product-key interactions.
- `escrow-config.js` — public frontend configuration.
- `contracts/RefundableProductEscrow.sol` — the tested 30-day escrow contract.
- `services/product-key/` — the signed-wallet product-key API, SQLite inventory, static server, and automated tests.
- `tokens.css` — shared design tokens used by the page.

Release notes are tracked in [`CHANGELOG.md`](CHANGELOG.md). The remaining real-money launch blockers are tracked in [`TODOS.md`](TODOS.md), and the current checkpoint version is stored in [`VERSION`](VERSION).

The step-by-step production gates are documented in [`docs/polygon-mainnet-runbook.md`](docs/polygon-mainnet-runbook.md). The included mainnet preflight is read-only: it validates public addresses, chain ID, review evidence, custody type, gas balance, compiler settings, and the immutable pledge conversion without accepting a private key or sending a transaction.

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

1. A supporter connects a Polygon-compatible wallet and places a first pre-order of at least the immutable on-chain minimum. The current Amoy rehearsal uses `0.01` test POL; `250 POL` remains the proposed mainnet setting. Later top-ups may be any positive amount while funding remains open.
2. The team publishes the product and records a public release-proof URL before the contract deadline. The Product Hunt launch URL can be used as that public evidence when it points to the usable release.
3. Each supporter independently approves or does not approve. Approval releases only that supporter’s pledge and makes the wallet eligible for a product key.
4. Every unapproved pledge becomes refundable after the deadline.

Refund eligibility activates automatically, but a blockchain contract cannot initiate its own transaction. The supporter or a refund bot must submit the refund transaction; the contract always sends the money to the original supporter wallet.

## Production setup

### 1. Deploy the contract

Deploy `contracts/RefundableProductEscrow.sol` to Polygon PoS mainnet only after the intended owner, beneficiary, and minimum pledge have passed an independent security review. The deploying wallet becomes the immutable owner, while the constructor beneficiary is the only wallet allowed to withdraw approved funds. Deployment starts the immutable 30-day clock and spends real POL. The existing `0.01` POL deployment is an Amoy rehearsal only; `250 POL` remains a proposal, not an approved production price.

Before preparing any deployment transaction, copy `.env.mainnet-preflight.example` to the ignored `.env.mainnet-preflight`, complete the public review fields, and run:

```sh
npm --prefix services/product-key run preflight:mainnet
```

This check must report `READY_FOR_MANUAL_DEPLOYMENT_REVIEW`. It cannot deploy the contract. Follow the complete runbook before switching the public configuration away from Amoy.

The minimum cannot be changed after deployment. The page reads the exact value from the contract instead of trusting a frontend-only setting. Polygon USDC support is intentionally deferred; this version accepts native POL only.

### 2. Configure the landing page

`escrow-config.js` currently points to the verified Amoy rehearsal contract `0x6bF097816997C242F3447A470d1cc3d170cbcB98` on chain `80002`, deployed at block `42475668`. For the later audited mainnet deployment, replace it with:

```js
window.PIRATE_ESCROW_CONFIG = Object.freeze({
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

Product keys must never be embedded in the public frontend. Deploy `services/product-key` with its SQLite database on persistent encrypted storage, the exact contract address, a secret administrator token, and private product-key inventory.

The included server serves the landing page and `/api/*` from one origin and keeps `keyApiBase` empty. In production, place it behind HTTPS and a trusted reverse proxy, set `TRUST_PROXY=true`, and block direct access to the Node port. The rate limiter uses the last address in `X-Forwarded-For`, which matches an AWS Application Load Balancer directly appending the real client address. A separate API origin requires setting one exact `CORS_ORIGIN` on the service and setting `keyApiBase` to that HTTPS origin in `escrow-config.js`; never allow `*` for the wallet-verification endpoints.

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

The API uses JSON and returns errors as `{ "error": "..." }`:

- `GET /api/health` returns `{ "ok": true }`.
- `POST /api/auth/challenge` accepts `{ "address": "0x..." }` and returns `{ "challengeId", "address", "message", "expiresAt" }`. The short-lived message is what the wallet signs. Wallet-verification requests are rate limited.
- `POST /api/keys/redeem` accepts `{ "challengeId": "...", "address": "0x...", "signature": "0x..." }`. It returns `{ "productKey": "...", "existing": false }` for a new assignment or `existing: true` for the stable key already assigned to that approved wallet.
- `POST /api/admin/keys` accepts `{ "keys": ["..."] }` plus `Authorization: Bearer <ADMIN_TOKEN>` and returns `{ "inserted", "inventory" }`. It rejects empty values and keys over 256 characters, and imports at most 1,000 keys per request.

Runtime configuration:

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Dedicated Polygon JSON-RPC endpoint used for entitlement checks. |
| `CONTRACT_ADDRESS` | Exact deployed escrow address; startup fails if it differs from the public browser config. |
| `PUBLIC_ORIGIN` | Public origin used in signed wallet challenges. |
| `CORS_ORIGIN` | Optional single allowed browser origin when the API is hosted separately. |
| `ADMIN_TOKEN` | Private inventory-administration token with at least 32 random characters. |
| `RPC_TIMEOUT_MS` | Timeout for an upstream Polygon verification request; defaults to `10000`. |
| `VERIFICATION_MAX_CONCURRENT` | Maximum simultaneous on-chain entitlement checks; defaults to `8`. |
| `VERIFICATION_MAX_QUEUED` | Maximum checks waiting for capacity; defaults to `32`. |
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

The integrated process bounds its local rate-limit and challenge stores, limits concurrent on-chain entitlement checks, queues only a small amount of verification work, and applies an RPC timeout. Keep equivalent request and concurrency limits at the reverse proxy. A multi-instance mainnet service should replace process-local state with shared TTL storage and keep the API inaccessible except through its trusted proxy.

### AWS container deployment

The root `Dockerfile` packages the landing page and product-key service into one non-root Node.js image. Use `.env.docker.example` for the local check above. `.env.aws.example` is the AWS Amoy rehearsal template; it intentionally contains no RPC credential or administrator token. Before publishing the image to Amazon ECR, verify `curl --fail http://127.0.0.1:4173/api/health` returns `{"ok":true}` from the local container. Do not add `.env.docker`, `.env.aws`, or any secret to the image or repository.

Recommended first AWS deployment:

1. Push the tested image to a private Amazon ECR repository.
2. Create an ECS Fargate task exposing container port `4173`. Inject `RPC_URL` and `ADMIN_TOKEN` from AWS Secrets Manager; set the other values from `.env.aws.example` in the task definition.
3. Mount an encrypted Amazon EFS access point at `/data`. Configure its POSIX owner as UID/GID `1000`, permissions `0700`, and enable transit encryption so the image's non-root `node` user can create the SQLite database.
4. Put the task in private subnets behind an Application Load Balancer with an ACM HTTPS certificate. Allow task port `4173` only from the load balancer security group. Set `PUBLIC_ORIGIN` to the final `https://` host and `TRUST_PROXY=true`.
5. Configure both the load balancer target-group health check and the ECS task-definition health check to use `GET /api/health`. The Docker image has its own health check, but ECS only monitors a container health check declared in the task definition.
6. Keep the service at exactly one desired task for this SQLite/process-local implementation. Set the rolling deployment limits to minimum healthy `0%` and maximum `100%` so old and new tasks do not overlap; this trades a brief deployment interruption for single-writer safety. Do not enable horizontal scaling until challenges, rate limits, and key assignment use shared production storage.
7. Enable EFS backups, CloudWatch logs, and alarms for unhealthy targets and HTTP `5xx` responses before loading real product keys.

The checked-in `.env.aws.example` still targets Polygon Amoy. For mainnet, deploy the audited contract first, then update `escrow-config.js` and `CONTRACT_ADDRESS` together and rebuild the image. Never reuse the rehearsal administrator token or product-key database.

### 4. Publish the release

Before the deadline, the contract owner connects the owner wallet and uses the owner-only release panel to call `markProductReleased(proofURI)` with a stable HTTPS URL for the usable production release. The panel is hidden from non-owner wallets and uses a normal wallet transaction—no private key is entered into the site. Recording a marketing post alone does not approve anyone’s pledge; every supporter still makes an individual decision.

### 5. Process unresolved refunds

Supporters can always call `claimRefund()` from the page after expiry. The optional refund processor can call `processRefund(supporter)` for unapproved wallets. The processor pays gas but cannot redirect the refund.

The beneficiary can separately call `withdrawApprovedFunds()` to withdraw only the pledges that supporters explicitly approved. Unapproved pledges never enter the beneficiary’s withdrawable balance.

## Mainnet safety checklist

- Obtain an independent Solidity security audit before accepting funds.
- Verify the exact contract source on PolygonScan and link the verified address.
- Use a multisig or hardware wallet for owner and beneficiary roles.
- Keep deployer keys, administrator tokens, RPC credentials, and product keys out of this repository.
- Publish a precise definition of “released” before accepting pre-orders.
- Explain that approval permanently gives up the refund for that pledge.
- Back up the product-key database and inventory.

This implementation is not a security audit or legal opinion.

The repository release uses the four-part checkpoint version in `VERSION`; the private Node service keeps the npm-compatible package version `0.1.0`.
