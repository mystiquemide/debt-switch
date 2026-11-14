// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

// Pulls Morpho Blue v1.0.0 and AdaptiveCurveIrm v1.0.0 into the build so tests and deploy
// scripts can deploy them by artifact name. Both are unmodified upstream sources.
import {Morpho} from "morpho-blue/Morpho.sol";
import {AdaptiveCurveIrm} from "morpho-blue-irm/AdaptiveCurveIrm.sol";
