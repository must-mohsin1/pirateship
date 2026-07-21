# Pirate Network mainnet release criteria (draft)

Status: **team, finance, and legal review required before publishing**.

The team may record release evidence in the escrow contract only when all of
the following statements are true:

1. A public production Pirate Network product is available over HTTPS and is
   usable by supporters, not merely a landing page, waitlist, mock-up, source
   repository, marketing announcement, or Product Hunt preview.
2. An approved supporter can retrieve one stable `PIRATE-POL-*` license after
   proving control of the same wallet that approved its funded pledge.
3. The released product accepts or validates that license and explains what
   access the license grants.
4. The product, wallet-verification service, dedicated Polygon RPC, shared
   Redis datastore, backups, monitoring, and support process have passed the
   production canary.
5. The public release-evidence URL identifies the usable product and its
   Product Hunt launch. It remains accessible after the on-chain transaction.

Supporter terms to publish beside these criteria:

- Each first pledge must be at least `300 POL`.
- The contract deadline is exactly 30 days after mainnet deployment.
- Approval is optional and permanent. It releases only that supporter's
  approved pledge to the beneficiary.
- A supporter should approve only after reviewing and accepting the usable
  released product.
- If the supporter does not approve, the full funded pledge becomes refundable
  after the deadline. The supporter or another caller must submit the refund
  transaction; the contract sends the funds only to the original supporter.
- Native POL is volatile, and blockchain gas fees are separate from the pledge.

Before publishing, replace this draft status with the approving team and date,
link the production product and license terms, and have finance/legal approve
the wording. The final HTTPS URL becomes immutable release evidence once the
owner records it on chain.
