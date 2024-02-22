// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IVault.sol";

contract Vault is Context, Ownable, IVault {
	using SafeERC20 for IERC20;

	address public immutable TES;		
	address public stakingPool;

	constructor(address _TES) {
		TES = _TES;
		stakingPool = _msgSender();
    }

	function claim(uint256 _amount) public {
		require(_msgSender() == stakingPool, "FORBIDDEN");
		_safeTransfer(_msgSender(), _amount);
	}

	function setStakingPool(address _stakingPool) external onlyOwner() {
		stakingPool = _stakingPool;
	}

	function withdraw(uint256 _amount) external onlyOwner() {
		_safeTransfer(_msgSender(), _amount);
	}

	function _safeTransfer(address _to, uint256 _amount) internal {
		uint256 balance = IERC20(TES).balanceOf(address(this));
		if (_amount > balance) {
			IERC20(TES).safeTransfer(_to, balance);
		} else {
			IERC20(TES).safeTransfer( _to, _amount);
		}
	}
}
