// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SimpleToken} from "../src/SimpleToken.sol";

interface IVault {
    function deposit(address token, uint256 amount) external;
}

/// @title MintApproveDeposit
/// @notice Mints tokens by sending ETH, approves the vault, then deposits all minted tokens.
///         Set TOKEN_ADDRESS env var to the deployed SimpleToken address.
///         Set ETH_AMOUNT env var in wei (e.g. 1000000000000000 = 0.001 ETH)
contract MintApproveDeposit is Script {
    address constant VAULT = 0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13;

function run(uint256 ethAmount) external {
    uint256 deployerPK = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerPK);
    address tokenAddr = vm.envAddress("TOKEN_ADDRESS");

    SimpleToken token = SimpleToken(tokenAddr);

    console.log("Deployer:", deployer);
    console.log("Token:", tokenAddr);
    console.log("ETH to spend:", ethAmount);
    console.log("Tokens to receive:", token.previewMint(ethAmount));

    vm.startBroadcast(deployerPK);

    token.mint{value: ethAmount}(deployer);

    uint256 balance = token.balanceOf(deployer);
    IERC20(tokenAddr).approve(VAULT, balance);

    IVault(VAULT).deposit(tokenAddr, balance);

    vm.stopBroadcast();

    console.log("------------------------------------");
    console.log("Minted, approved and deposited", balance, "tokens into vault");
    console.log("------------------------------------");
}
}