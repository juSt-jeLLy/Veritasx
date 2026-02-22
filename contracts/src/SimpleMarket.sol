// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReceiverTemplate } from "./interfaces/ReceiverTemplate.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SimpleMarket is ReceiverTemplate {
    using SafeERC20 for IERC20;

    event SettlementRequested(uint256 indexed marketId, string question);
    event SettlementResponse(uint256 indexed marketId, Status indexed status, Outcome indexed outcome);
    event MarketClosed(uint256 indexed marketId);

    enum Outcome { None, No, Yes, Inconclusive }
    enum Status { Open, SettlementRequested, Settled, NeedsManual }

    error StatusNotOpen(Status current);
    error SettlementNotRequested(Status current);
    error InvalidOutcome();
    error ManualSettlementNotAllowed(Status current);
    error MarketStillOpen();
    error AlreadyPredicted();
    error AmountZero();
    error MarketIsClosed();
    error NotSettledYet(Status current);
    error AlreadyClaimed();
    error IncorrectPrediction();
    error NoWinners();

    struct Market {
        string question;
        uint256 marketOpen;
        bool closed;
        Status status;
        Outcome outcome;
        uint256 settledAt;
        string evidenceURI;
        uint16 confidenceBps;
        uint256[2] predCounts;
        uint256[2] predTotals;
    }

    struct Prediction {
        uint256 amount;
        Outcome pred;
        bool claimed;
    }

    uint256 public nextMarketId;
    mapping (uint256 => Market) public markets;
    mapping (uint256 => mapping (address => Prediction)) predictions;
    IERC20 public immutable paymentToken;

    constructor(address token, address forwarderAddress) ReceiverTemplate(forwarderAddress) {
        paymentToken = IERC20(token);
    }

    function newMarket(string memory question) public returns (uint256) {
        Market storage m = markets[nextMarketId++];
        m.question = question;
        m.marketOpen = block.timestamp;
        m.closed = false;
        return nextMarketId - 1;
    }

    function closeMarket(uint256 marketId) public {
        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert StatusNotOpen(m.status);
        if (m.closed) revert MarketIsClosed();
        m.closed = true;
        emit MarketClosed(marketId);
    }

    function getMarket(uint256 marketId) public view returns (Market memory) {
        return markets[marketId];
    }

    function requestSettlement(uint256 marketId) public {
        Market storage m = markets[marketId];
        if (!m.closed) revert MarketStillOpen();
        if (m.status != Status.Open) revert StatusNotOpen(m.status);
        m.status = Status.SettlementRequested;
        emit SettlementRequested(marketId, m.question);
    }

    function settleMarket(uint256 marketId, Outcome outcome, uint16 confidenceBps, string memory evidenceURI) private {
        Market storage m = markets[marketId];
        if (m.status != Status.SettlementRequested) revert SettlementNotRequested(m.status);
        m.outcome = outcome;
        m.settledAt = block.timestamp;
        m.confidenceBps = confidenceBps;
        m.evidenceURI = evidenceURI;
        if (outcome == Outcome.Inconclusive) {
            m.status = Status.NeedsManual;
        } else {
            m.status = Status.Settled;
        }
        emit SettlementResponse(marketId, m.status, m.outcome);
    }

    function settleMarketManually(uint256 marketId, Outcome outcome) public {
        Market storage m = markets[marketId];
        if (outcome != Outcome.No && outcome != Outcome.Yes) revert InvalidOutcome();
        if (m.status != Status.NeedsManual) revert ManualSettlementNotAllowed(m.status);
        m.outcome = outcome;
        m.settledAt = block.timestamp;
        m.status = Status.Settled;
        emit SettlementResponse(marketId, m.status, m.outcome);
    }

    function _processReport(bytes calldata report) internal override {
        if (report.length > 0 && report[0] == 0x01) {
            (uint256 marketId, uint8 outcome, uint16 confidenceBps, string memory responseId) =
                abi.decode(report[1:], (uint256, uint8, uint16, string));
            settleMarket(marketId, Outcome(outcome), confidenceBps, responseId);
        } else {
            string memory question = abi.decode(report, (string));
            newMarket(question);
        }
    }

    function getUri(uint256 marketId) public view returns (string memory) {
        return string.concat("http://localhost:3000/", markets[marketId].evidenceURI);
    }

    function makePrediction(uint256 marketId, Outcome outcome, uint256 amount) public {
        Market storage m = markets[marketId];
        if (m.closed) revert MarketIsClosed();
        if (m.status != Status.Open) revert StatusNotOpen(m.status);
        if (predictions[marketId][msg.sender].pred != Outcome.None) revert AlreadyPredicted();
        if (outcome != Outcome.No && outcome != Outcome.Yes) revert InvalidOutcome();
        if (amount == 0) revert AmountZero();
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        predictions[marketId][msg.sender] = Prediction({ amount: amount, pred: outcome, claimed: false });
        markets[marketId].predTotals[uint8(outcome) - 1] += amount;
        markets[marketId].predCounts[uint8(outcome) - 1]++;
    }

    function getPrediction(uint256 marketId) public view returns (Prediction memory) {
        return predictions[marketId][msg.sender];
    }

    function claimPrediction(uint256 marketId) public {
        Market storage m = markets[marketId];
        Prediction storage p = predictions[marketId][msg.sender];
        if (m.status != Status.Settled) revert NotSettledYet(m.status);
        if (p.claimed) revert AlreadyClaimed();
        if (m.outcome != p.pred) revert IncorrectPrediction();
        uint8 outcomeIndex = uint8(m.outcome);
        uint256 userStake = p.amount;
        uint256 totalPool = m.predTotals[0] + m.predTotals[1];
        uint256 winningTotal = m.predTotals[outcomeIndex - 1];
        if (winningTotal == 0) revert NoWinners();
        uint256 payoutAmount = (userStake * totalPool) / winningTotal;
        p.claimed = true;
        paymentToken.safeTransfer(msg.sender, payoutAmount);
    }
}