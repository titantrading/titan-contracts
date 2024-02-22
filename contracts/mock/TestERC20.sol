// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract TestERC20 is ERC20 {
    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function burn(uint256 _amount) public {
        _burn(msg.sender, _amount);
    }

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
}
