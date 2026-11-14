// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";

// TEST-ONLY. Never deployed. Mezo implements the BTC token (0x7b7C...0000) and the BTC/USD oracle
// (0x7b7c...0015) natively in the chain, and a Foundry fork can't execute them. These stand-ins are
// etched over those addresses inside fork tests so the rest of the system runs on real fork state.
// Live-chain behavior is proven separately by script/btc-roundtrip.sh and real testnet transactions.

Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

/// Mirrors Mezo's BTC token: the ERC-20 balance IS the native balance.
contract BtcStandIn {
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function name() external pure returns (string memory) {
        return "Bitcoin";
    }

    function symbol() external pure returns (string memory) {
        return "BTC";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function balanceOf(address a) external view returns (uint256) {
        return a.balance;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "BTC: allowance");
            allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(from.balance >= amount, "BTC: balance");
        VM.deal(from, from.balance - amount);
        VM.deal(to, to.balance + amount);
        emit Transfer(from, to, amount);
    }
}

/// Serves the live Mezo oracle answer captured at fork time, stamped as fresh.
contract OracleStandIn {
    int256 private immutable answer;
    uint8 public immutable decimals;

    constructor(int256 answer_, uint8 decimals_) {
        answer = answer_;
        decimals = decimals_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
