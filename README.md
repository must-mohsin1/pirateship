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

The included server serves the landing page and `/api/*` from one origin and keeps `keyApiBase` empty. In production, place it behind HTTPS and a trusted reverse proxy, set `TRUST_PROXY=true`, block direct access to the Node port, and configure the proxy to overwrite—not append untrusted—forwarding headers. Otherwise all supporters can share one proxy rate-limit bucket, or attackers can spoof client addresses. A separate API origin requires setting one exact `CORS_ORIGIN` on the service and setting `keyApiBase` to that HTTPS origin in `escrow-config.js`; never allow `*` for the wallet-verification endpoints.

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

The integrated process bounds its local rate-limit and challenge stores, limits concurrent on-chain entitlement checks, queues only a small amount of verification work, and applies an RPC timeout. Keep equivalent request and concurrency limits at the reverse proxy. A multi-instance mainnet service should replace process-local state with shared TTL storage and keep the API inaccessible except through a proxy that overwrites forwarding headers.

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
