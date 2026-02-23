// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title SimpleToken
/// @notice A simple ERC20 token where anyone can mint by paying ETH,
///         and burn to reclaim that ETH. Price is fixed forever at deploy.
contract SimpleToken is ERC20, ERC20Permit {
    /// @notice ETH cost per 1 whole token (1e18 units). Fixed at deployment.
    uint256 public immutable pricePerToken;

    event Minted(address indexed to, uint256 amount, uint256 ethPaid);
    event Burned(address indexed from, uint256 amount, uint256 ethReturned);

    error BurnAmountZero();
    error ETHTransferFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 pricePerToken_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        require(pricePerToken_ > 0, "Price must be > 0");
        pricePerToken = pricePerToken_;
    }

    /// @notice Mint tokens by sending ETH.
    function mint(address to) external payable {
        uint256 amount = (msg.value * 1e18) / pricePerToken;
        require(amount > 0, "Send more ETH");

        _mint(to, amount);
        emit Minted(to, amount, msg.value);
    }

    /// @notice Burn tokens and receive back the proportional ETH.
    function burn(uint256 amount) external {
        if (amount == 0) revert BurnAmountZero();

        uint256 ethToReturn = (amount * pricePerToken) / 1e18;

        _burn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: ethToReturn}("");
        if (!success) revert ETHTransferFailed();

        emit Burned(msg.sender, amount, ethToReturn);
    }

    /// @notice Preview how many tokens you'd get for a given ETH amount.
    function previewMint(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * 1e18) / pricePerToken;
    }

    /// @notice Preview how much ETH you'd get back for burning a token amount.
    function previewBurn(uint256 tokenAmount) external view returns (uint256) {
        return (tokenAmount * pricePerToken) / 1e18;
    }
}