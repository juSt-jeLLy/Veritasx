// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {SimpleToken} from "../src/SimpleToken.sol";

contract DeployToken is Script {
    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPK);

        SimpleToken token = new SimpleToken(
            "PREDICT",
            "PRED",
            0.001 ether  // pricePerToken
        );

        vm.stopBroadcast();

        console.log("------------------------------------");
        console.log("SimpleToken deployed at:", address(token));
        console.log("------------------------------------");
    }
}