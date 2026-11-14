// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// Mezo's EIP-712 delegation layer for MUSD troves.
interface IBorrowerOperationsSignatures {
    function openTroveWithSignature(
        uint256 debtAmount,
        address upperHint,
        address lowerHint,
        address borrower,
        address recipient,
        bytes memory signature,
        uint256 deadline
    ) external payable;

    function getNonce(address user) external view returns (uint256);
}

interface IBorrowerOperations {
    function minNetDebt() external view returns (uint256);
    function borrowingRate() external view returns (uint256);
    function getBorrowingFee(uint256 debt) external view returns (uint256);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/// Mezo Pools (Velodrome-style) basic router.
interface IPoolRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);
}
