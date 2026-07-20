// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RefundableProductEscrow
/// @notice A 30-day, per-supporter escrow for a refundable product pre-order.
/// @dev Approval is individual: only an approving supporter's pledge becomes withdrawable.
contract RefundableProductEscrow {
    uint64 public constant CAMPAIGN_DURATION = 30 days;

    enum Phase {
        Funding,
        Released,
        Refunds
    }

    struct Supporter {
        uint256 amount;
        bool approved;
        bool refunded;
    }

    address public immutable owner;
    address payable public immutable beneficiary;
    uint64 public immutable deadline;
    uint256 public immutable minimumPledge;

    bool public productReleased;
    uint64 public releasedAt;
    string public productReleaseProof;

    uint256 public totalPledged;
    uint256 public totalApproved;
    uint256 public totalRefunded;
    uint256 public withdrawableApproved;

    mapping(address => Supporter) public supporters;

    uint256 private locked = 1;

    error ApprovalClosed();
    error CampaignClosed();
    error FundingClosed();
    error InvalidAddress();
    error InvalidMinimumPledge();
    error InvalidProof();
    error NoApprovedFunds();
    error NoPledge();
    error NotBeneficiary();
    error NotOwner();
    error ProductAlreadyReleased();
    error ProductNotReleased();
    error PledgeBelowMinimum(uint256 minimumPledge);
    error RefundNotAvailable();
    error SupporterAlreadyApproved();
    error SupporterAlreadyRefunded();
    error TransferFailed();
    error ZeroContribution();

    event ContributionReceived(address indexed supporter, uint256 amount, uint256 supporterTotal);
    event ProductReleased(string proofURI, uint64 releasedAt);
    event ProductApproved(address indexed supporter, uint256 amount);
    event RefundProcessed(address indexed supporter, address indexed processor, uint256 amount);
    event ApprovedFundsWithdrawn(address indexed beneficiary, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        require(locked == 1, "REENTRANCY");
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address payable beneficiary_, uint256 minimumPledge_) {
        if (beneficiary_ == address(0)) revert InvalidAddress();
        if (minimumPledge_ == 0) revert InvalidMinimumPledge();
        owner = msg.sender;
        beneficiary = beneficiary_;
        minimumPledge = minimumPledge_;
        deadline = uint64(block.timestamp) + CAMPAIGN_DURATION;
    }

    receive() external payable {
        contribute();
    }

    /// @notice Add native POL to the caller's refundable pledge before release or deadline.
    function contribute() public payable {
        if (msg.value == 0) revert ZeroContribution();
        if (block.timestamp >= deadline) revert CampaignClosed();
        if (productReleased) revert FundingClosed();

        Supporter storage supporter = supporters[msg.sender];
        if (supporter.approved) revert SupporterAlreadyApproved();
        if (supporter.refunded) revert SupporterAlreadyRefunded();
        if (supporter.amount == 0 && msg.value < minimumPledge) {
            revert PledgeBelowMinimum(minimumPledge);
        }

        supporter.amount += msg.value;
        totalPledged += msg.value;

        emit ContributionReceived(msg.sender, msg.value, supporter.amount);
    }

    /// @notice Record objective release evidence before the 30-day deadline.
    function markProductReleased(string calldata proofURI) external onlyOwner {
        if (block.timestamp >= deadline) revert CampaignClosed();
        if (productReleased) revert ProductAlreadyReleased();
        if (bytes(proofURI).length == 0) revert InvalidProof();

        productReleased = true;
        releasedAt = uint64(block.timestamp);
        productReleaseProof = proofURI;

        emit ProductReleased(proofURI, releasedAt);
    }

    /// @notice Approve the released product and make the caller's pledge withdrawable.
    function approveProduct() external {
        if (block.timestamp >= deadline) revert ApprovalClosed();
        if (!productReleased) revert ProductNotReleased();

        Supporter storage supporter = supporters[msg.sender];
        if (supporter.amount == 0) revert NoPledge();
        if (supporter.approved) revert SupporterAlreadyApproved();
        if (supporter.refunded) revert SupporterAlreadyRefunded();

        supporter.approved = true;
        totalApproved += supporter.amount;
        withdrawableApproved += supporter.amount;

        emit ProductApproved(msg.sender, supporter.amount);
    }

    /// @notice Claim the caller's unapproved pledge after the campaign deadline.
    function claimRefund() external {
        _processRefund(payable(msg.sender));
    }

    /// @notice Permissionless refund entry point for keepers or community automation.
    /// @dev Funds always go to supporter, never to the caller processing the refund.
    function processRefund(address payable supporter) external {
        _processRefund(supporter);
    }

    /// @notice Withdraw only funds explicitly approved by their supporters.
    function withdrawApprovedFunds() external nonReentrant {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        uint256 amount = withdrawableApproved;
        if (amount == 0) revert NoApprovedFunds();

        withdrawableApproved = 0;
        (bool sent, ) = beneficiary.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit ApprovedFundsWithdrawn(beneficiary, amount);
    }

    function phase() external view returns (Phase) {
        if (block.timestamp >= deadline) return Phase.Refunds;
        if (productReleased) return Phase.Released;
        return Phase.Funding;
    }

    function isKeyEligible(address supporter) external view returns (bool) {
        Supporter storage record = supporters[supporter];
        return record.amount >= minimumPledge && record.approved && !record.refunded;
    }

    function refundableAmount(address supporter) external view returns (uint256) {
        Supporter storage record = supporters[supporter];
        if (block.timestamp < deadline || record.approved || record.refunded) return 0;
        return record.amount;
    }

    function _processRefund(address payable supporterAddress) private nonReentrant {
        if (block.timestamp < deadline) revert RefundNotAvailable();

        Supporter storage supporter = supporters[supporterAddress];
        if (supporter.amount == 0) revert NoPledge();
        if (supporter.approved) revert SupporterAlreadyApproved();
        if (supporter.refunded) revert SupporterAlreadyRefunded();

        uint256 amount = supporter.amount;
        supporter.refunded = true;
        totalRefunded += amount;

        (bool sent, ) = supporterAddress.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit RefundProcessed(supporterAddress, msg.sender, amount);
    }
}
