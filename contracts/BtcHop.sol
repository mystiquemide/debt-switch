// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Proves that a contract on Mezo can take BTC in one form and hand it on in the other.
/// @dev Native BTC and the ERC-20 at 0x7b7C share one balance on Mezo. This contract checks both
///      directions of the hop that DebtSwitchRouter relies on.
contract BtcHop {
    IERC20 public constant BTC = IERC20(0x7b7C000000000000000000000000000000000000);

    address public immutable owner;

    error TransferFailed();
    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    receive() external payable {}

    /// Native BTC held by this contract leaves as an ERC-20 transfer.
    function forwardAsErc20(address to, uint256 amount) external onlyOwner {
        if (!BTC.transfer(to, amount)) revert TransferFailed();
    }

    /// ERC-20 BTC pulled from the caller leaves as native value.
    function forwardAsNative(address payable to, uint256 amount) external onlyOwner {
        if (!BTC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
