// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { SimpleMarket } from "../src/SimpleMarket.sol";

contract DeploySimpleMarket is Script {
    // CRE Mock Forwarder — Ethereum Sepolia (simulation only)
    // Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory
    address constant FORWARDER_ADDRESS = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        SimpleMarket market = new SimpleMarket(FORWARDER_ADDRESS);

        console.log("SimpleMarket deployed at:", address(market));

        vm.stopBroadcast();
    }
}