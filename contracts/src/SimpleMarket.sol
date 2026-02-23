// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReceiverTemplate } from "./interfaces/ReceiverTemplate.sol";

contract SimpleMarket is ReceiverTemplate {

    // ═══════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        address escrowShieldedAddress,
        address tokenAddress
    );
    event MarketClosed(uint256 indexed marketId);
    event SettlementRequested(uint256 indexed marketId, string question);
    event SettlementResponse(
        uint256 indexed marketId,
        Status indexed status,
        Outcome indexed outcome
    );
    event AggregateUpdated(
        uint256 indexed marketId,
        uint256 noTotal,
        uint256 yesTotal,
        uint256 noCount,
        uint256 yesCount
    );

    // ═══════════════════════════════════════════════════════════════
    // Types
    // ═══════════════════════════════════════════════════════════════

    enum Outcome { None, No, Yes, Inconclusive }
    enum Status { Open, SettlementRequested, Settled, NeedsManual }

    struct Market {
        string question;
        address escrowShieldedAddress; // bettors send private transfers here
        address tokenAddress;          // ERC20 token for this market
        uint256 marketOpen;
        uint256 closedAt;
        bool closed;
        Status status;
        // Settlement fields
        Outcome outcome;
        uint256 settledAt;
        string evidenceURI;            // Gemini response ID for auditability
        uint16 confidenceBps;          // Gemini confidence 0-10000
        // Aggregates only — no individual bettor data
        uint256[2] predTotals;         // [NO total wei, YES total wei]
        uint256[2] predCounts;         // [NO count, YES count]
    }

    // ═══════════════════════════════════════════════════════════════
    // Errors
    // ═══════════════════════════════════════════════════════════════

    error StatusNotOpen(Status current);
    error SettlementNotRequested(Status current);
    error ManualSettlementNotAllowed(Status current);
    error InvalidOutcome();
    error MarketStillOpen();
    error MarketIsClosed();
    error MarketNotFound();

    // ═══════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;

    // ═══════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════

    constructor(address forwarderAddress) ReceiverTemplate(forwarderAddress) {}

    // ═══════════════════════════════════════════════════════════════
    // CRE Report Router — only CRE can call this via forwarder
    // ═══════════════════════════════════════════════════════════════

    function _processReport(bytes calldata report) internal override {
        require(report.length > 0, "Empty report");
        bytes1 prefix = report[0];

        if (prefix == 0x00) {
            // ── Create Market ──────────────────────────────────────
            // Called by: createMarket CRE workflow (HTTP trigger)
            // Stores: question, escrow shielded address, token
            // Privacy: escrow shielded address hides escrow identity
            (
                string memory question,
                address escrowShieldedAddress,
                address tokenAddress
            ) = abi.decode(report[1:], (string, address, address));

            _newMarket(question, escrowShieldedAddress, tokenAddress);

        } else if (prefix == 0x01) {
            // ── Settle Market ──────────────────────────────────────
            // Called by: settleAndPayout CRE workflow (EVM log trigger)
            // Stores: outcome + final aggregate totals only
            // Privacy: NO individual winner data, NO payout amounts
            //          Gemini response ID stored for public auditability
            (
                uint256 marketId,
                uint8 outcome,
                uint16 confidenceBps,
                string memory evidenceURI,
                uint256 noTotal,
                uint256 yesTotal,
                uint256 noCount,
                uint256 yesCount
            ) = abi.decode(
                report[1:],
                (uint256, uint8, uint16, string, uint256, uint256, uint256, uint256)
            );

            _settleMarket(
                marketId,
                Outcome(outcome),
                confidenceBps,
                evidenceURI,
                noTotal,
                yesTotal,
                noCount,
                yesCount
            );

        } else if (prefix == 0x02) {
            // ── Update Aggregate Totals ────────────────────────────
            // Called by: placeBet CRE workflow (HTTP trigger)
            // Stores: ONLY aggregate pool sizes — no bettor address,
            //         no individual amount, no outcome choice
            // Privacy: on-chain observer sees pool growing but cannot
            //          link any address to any bet
            (
                uint256 marketId,
                uint8 outcomeIndex, // 0 = NO, 1 = YES
                uint256 amount
            ) = abi.decode(report[1:], (uint256, uint8, uint256));

            _updateAggregates(marketId, outcomeIndex, amount);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Internal — CRE report handlers
    // ═══════════════════════════════════════════════════════════════

    function _newMarket(
        string memory question,
        address escrowShieldedAddress,
        address tokenAddress
    ) internal {
        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.question = question;
        m.escrowShieldedAddress = escrowShieldedAddress;
        m.tokenAddress = tokenAddress;
        m.marketOpen = block.timestamp;
        m.status = Status.Open;

        emit MarketCreated(marketId, question, escrowShieldedAddress, tokenAddress);
    }

    function _updateAggregates(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 amount
    ) internal {
        Market storage m = markets[marketId];
        // Validate market is still open
        if (m.closed) revert MarketIsClosed();
        if (m.status != Status.Open) revert StatusNotOpen(m.status);

        m.predTotals[outcomeIndex] += amount;
        m.predCounts[outcomeIndex]++;

        emit AggregateUpdated(
            marketId,
            m.predTotals[0],
            m.predTotals[1],
            m.predCounts[0],
            m.predCounts[1]
        );
    }

    function _settleMarket(
        uint256 marketId,
        Outcome outcome,
        uint16 confidenceBps,
        string memory evidenceURI,
        uint256 noTotal,
        uint256 yesTotal,
        uint256 noCount,
        uint256 yesCount
    ) internal {
        Market storage m = markets[marketId];
        if (m.status != Status.SettlementRequested) revert SettlementNotRequested(m.status);

        m.outcome = outcome;
        m.settledAt = block.timestamp;
        m.confidenceBps = confidenceBps;
        m.evidenceURI = evidenceURI;
        // Write final confirmed aggregates from Firestore
        // (more accurate than incremental on-chain updates)
        m.predTotals = [noTotal, yesTotal];
        m.predCounts = [noCount, yesCount];
        m.status = outcome == Outcome.Inconclusive
            ? Status.NeedsManual
            : Status.Settled;

        emit SettlementResponse(marketId, m.status, m.outcome);
    }

    // ═══════════════════════════════════════════════════════════════
    // Public — called by anyone (market lifecycle)
    // ═══════════════════════════════════════════════════════════════

    function closeMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert StatusNotOpen(m.status);
        if (m.closed) revert MarketIsClosed();

        m.closed = true;
        m.closedAt = block.timestamp;

        emit MarketClosed(marketId);
    }

    function requestSettlement(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (!m.closed) revert MarketStillOpen();
        if (m.status != Status.Open) revert StatusNotOpen(m.status);

        m.status = Status.SettlementRequested;

        emit SettlementRequested(marketId, m.question);
    }

    // Manual override for Inconclusive outcomes
    function settleMarketManually(uint256 marketId, Outcome outcome) external {
        Market storage m = markets[marketId];
        if (outcome != Outcome.No && outcome != Outcome.Yes) revert InvalidOutcome();
        if (m.status != Status.NeedsManual) revert ManualSettlementNotAllowed(m.status);

        m.outcome = outcome;
        m.settledAt = block.timestamp;
        m.status = Status.Settled;

        emit SettlementResponse(marketId, m.status, m.outcome);
    }

    // ═══════════════════════════════════════════════════════════════
    // View
    // ═══════════════════════════════════════════════════════════════

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarketCount() external view returns (uint256) {
        return nextMarketId;
    }

    function getPoolSizes(uint256 marketId)
        external
        view
        returns (uint256 noTotal, uint256 yesTotal, uint256 noCount, uint256 yesCount)
    {
        Market storage m = markets[marketId];
        return (m.predTotals[0], m.predTotals[1], m.predCounts[0], m.predCounts[1]);
    }

    function isSettled(uint256 marketId) external view returns (bool) {
        return markets[marketId].status == Status.Settled;
    }
}