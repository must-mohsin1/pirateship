# RefundableProductEscrow independent security review

Status: **template only — not an audit report and not approval to deploy**.

An independent Solidity reviewer should complete this document against the
final clean source commit. The reviewer must not be the person who wrote or
substantially changed the contract. Publish the completed report at a stable
public HTTPS URL, then use that URL as `AUDIT_REPORT_URL`.

## Review identity

| Field | Reviewer entry |
| --- | --- |
| Reviewer name | Pending |
| Organization | Pending |
| Contact or public profile | Pending |
| Review date | Pending |
| Independence/conflict statement | Pending |
| Final verdict | Pending: approved / approved with accepted risks / not approved |

## Exact review target

| Field | Required value |
| --- | --- |
| Repository | `https://github.com/mustcompany/must-pirateship` |
| Git commit | Pending final clean commit |
| Contract | `contracts/RefundableProductEscrow.sol` |
| Solidity compiler | `0.8.30` |
| Optimizer | enabled, `200` runs |
| EVM target | `paris` |
| Creation-bytecode SHA-256 | Pending final preflight |
| Constructor beneficiary | `0xcF9178cA7360066B25de9c142A4c155abf151D6f` |
| Constructor minimum pledge | `300000000000000000000` wei (`300 POL`) |
| Intended chain | Polygon PoS mainnet, chain ID `137` |

The reviewer should reproduce the creation bytecode with the checked-in pinned
compiler and compare its SHA-256 value with the deployment preflight output.

## Required threat model

Review at least these actors and failure modes:

- a malicious or compromised immutable owner;
- a malicious or compromised beneficiary;
- a supporter approving, refunding, or topping up in unexpected order;
- reentrancy during approval, refund, or withdrawal;
- denial of service caused by a reverting receiver;
- incorrect phase transitions at the release and deadline boundaries;
- release evidence that is empty, malformed, mutable, or unavailable;
- accounting divergence between total funded, approved, withdrawn, and refunded;
- forced POL transfers or unexpected contract balance;
- miner/validator timestamp influence around the 30-day deadline;
- a hot-wallet compromise before or after product release;
- front-running and duplicate transaction submission.

## Required invariants

State whether each invariant holds and cite the relevant lines or tests:

1. The owner cannot withdraw supporter funds merely by recording a release.
2. Only the beneficiary can withdraw, and only approved, not-yet-withdrawn funds.
3. A supporter can approve only its own funded and unapproved pledge.
4. Approval is possible only after release was recorded before the deadline.
5. An unapproved funded pledge can be refunded after the deadline regardless of
   who submits the transaction, and funds go only to the original supporter.
6. An approved pledge cannot also be refunded.
7. A refunded pledge cannot later be approved.
8. The minimum applies to a wallet's first pledge exactly as documented.
9. The deadline equals the deployment timestamp plus exactly 30 days.
10. External-value transfers cannot create a successful double spend through
    reentrancy or stale accounting.

## Findings

Use one section for every finding, including informational items.

### Finding ID and title

- Severity: critical / high / medium / low / informational
- Status: open / fixed and verified / accepted risk
- Affected code:
- Description:
- Exploit scenario:
- Impact:
- Recommendation:
- Resolution commit or written risk acceptance:
- Reviewer verification:

## Test and analysis evidence

Record the tools and versions used, commands executed, test results, manual
reasoning, and any assumptions. Include coverage of exact deadline-boundary
timestamps and every value-moving function.

## Final conclusion

The reviewer must state unambiguously whether this exact build is suitable for
the documented Polygon mainnet campaign. List every accepted residual risk,
including the permanent Trust Wallet single-owner custody exception.

Reviewer name and date: Pending

Report checksum or signature: Pending
