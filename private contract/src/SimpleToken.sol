// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract SimpleToken is ERC20, ERC20Permit {
    uint256 public immutable pricePerToken;

    mapping(address => bool) public blocked;

    event Minted(address indexed to, uint256 amount, uint256 ethPaid);
    event Burned(address indexed from, uint256 amount, uint256 ethReturned);

    error BurnAmountZero();
    error ETHTransferFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 pricePerToken_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        require(pricePerToken_ > 0, "Price must be > 0");
        pricePerToken = pricePerToken_;

        // Permanently blocked addresses — cannot be changed by anyone
        blocked[0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F] = true;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "Address is blocked from receiving this token");
        super._update(from, to, amount);
    }

    function mint(address to) external payable {
        uint256 amount = (msg.value * 1e18) / pricePerToken;
        require(amount > 0, "Send more ETH");
        _mint(to, amount);
        emit Minted(to, amount, msg.value);
    }

    function burn(uint256 amount) external {
        if (amount == 0) revert BurnAmountZero();
        uint256 ethToReturn = (amount * pricePerToken) / 1e18;
        _burn(msg.sender, amount);
        (bool success, ) = msg.sender.call{value: ethToReturn}("");
        if (!success) revert ETHTransferFailed();
        emit Burned(msg.sender, amount, ethToReturn);
    }

    function previewMint(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * 1e18) / pricePerToken;
    }

    function previewBurn(uint256 tokenAmount) external view returns (uint256) {
        return (tokenAmount * pricePerToken) / 1e18;
    }
}