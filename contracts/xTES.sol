// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

import "./Vault.sol";

//StakingPool allows staking TESs and getting xTESs back as proof to get rewards from pool.
contract xTES is Context, Ownable, ERC20("xTES", "xTES") {
    using SafeERC20 for IERC20;

    // Info of lock.
    struct Lock {
        uint256 id;
        uint256 amount; // the amount of locked share TOKENs.
        uint256 duration;
        uint256 unlockedAt; // the time in which this amount of locked share TOKENs can be released.
    }

    uint256 private _lockIdTracker;

    // The stake TOKEN!
    address public immutable stakeToken;
    // The vault!
    Vault public immutable vault;
    
    // Emergency state.
    bool public emergency;
    uint256 public constant TOKEN_UNIT = 1e18;
    // Reward created per block.
    uint256 public rewardPerBlock;
    // Minimum duration of time that stake tokens will be locked when leaving the pool.
    uint256 public minDurationLock;
    // Maximum duration of time that stake tokens will be locked when leaving the pool.
    uint256 public maxDurationLock;
    //The division factor is used when calculating the exchange rate
    uint256 public exchangeRateDivisor;
    // Last block number that reward distribution occurs.
    uint256 public lastRewardBlock;
    /// The last block number to which the reward is distributed
    uint256 public endBlock;

    mapping(address owner => uint256) private _lockedBalances;
    mapping (address owner => uint256[]) private _ownedLocks;
    mapping (uint256 lockId => uint256) _ownedLocksIndex;

    Lock[] private _allLocks;
    mapping (uint256 lockId => uint256) _allLocksIndex;

    ///@dev Emited when `rewardPerBlock` is changed from `account`.
    event RewardPerBlockChanged(address account, uint256 rewardPerBlock);

    ///@dev Emited when an `amount` of TOKENs is entered into the pool.
    event Enter(address indexed user, uint256 amount);

    ///@dev Emited when an `amount` of xTES is leave the pool.
    event Leave(address indexed user, uint256 amount, uint256 lockIndex);

    ///@dev Emited when an `lockIndex` lock is released the pool.
    event Release(address indexed user, uint256 lockIndex);

    ///@dev Emited when an `lockIndex` lock is cancelled the pool.
    event Cancel(address indexed user, uint256 lockIndex);

    constructor(
        address _stakeToken,
        uint256 _startBlock,
        uint256 _endBlock,
        uint256 _minDurationLock,
        uint256 _maxDurationLock
    ) {
        stakeToken = _stakeToken;
        lastRewardBlock = _startBlock;
        endBlock = _endBlock;
        minDurationLock = _minDurationLock;
        maxDurationLock = _maxDurationLock;
        exchangeRateDivisor = (maxDurationLock - minDurationLock) * 2;

        vault = new Vault(_stakeToken);
        vault.transferOwnership(_msgSender());

        _lockIdTracker++;
    }

    function getVotes(address account) public view returns (uint256) {
        uint256 voteableLockedAmount = 0;
        for(uint256 i = 0; i < lockLengthOf(account); i++) {
            uint256 lockId = _ownedLocks[account][i];
            uint256 lockIndex = _allLocksIndex[lockId];
            Lock memory lock = _allLocks[lockIndex];
            if (block.timestamp < lock.unlockedAt) {
                voteableLockedAmount += lock.amount;
            }
        }
        return super.balanceOf(account) + voteableLockedAmount;
    }

    function getTotalVotes() public view returns (uint256) {
        uint256 length = _allLocks.length;
        uint256 totalUnvoteableLockedAmount = 0;
        for(uint256 i = 0; i < length; i++) {
            Lock memory lock = _allLocks[i];
            if (block.timestamp >= lock.unlockedAt) {
                totalUnvoteableLockedAmount += lock.amount;
            }
        }
        return totalSupply() - totalUnvoteableLockedAmount;
    }

    function lockedBalanceOf(address account) public view returns (uint256) {
        return _lockedBalances[account];
    }

    function lockLengthOf(address account) public view returns (uint256) {
        return _ownedLocks[account].length;
    }

    function lockOfOwnerByIndex(address account, uint256 index) public view returns (Lock memory) {
        require(index < lockLengthOf(account), "OUT_OF_BOUNDS_INDEX");
        return _unsafeAccessLock(account, index);
    }

    function allLockLength() public view returns (uint256) {
        return _allLocks.length;
    }

    function lockByIndex(uint256 index) public view returns (Lock memory) {
        require(index < _allLocks.length, "OUT_OF_BOUNDS_INDEX");
        return _allLocks[index];
    }

    ///@dev Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint256 _from, uint256 _to) public view returns (uint256) {
        uint256 _endBlock = endBlock;   //gas saving
        if (_to <= _endBlock) {
            return _to - _from;
        } else if (_from >= _endBlock) {
            return 0;
        } else {
            return _endBlock - _from;
        }
    }

    ///@dev Returns the exchange rate xTES to TES.
    function exchangeRate() external view returns (uint256) {
        uint256 _lastRewardBlock = lastRewardBlock;
        uint256 totalLocked = IERC20(stakeToken).balanceOf(address(this));
        uint256 totalShares = totalSupply();
        if (totalLocked == 0 || totalShares == 0) {
            return TOKEN_UNIT;
        } else if (block.number > _lastRewardBlock) {
            uint256 multiplier = getMultiplier(_lastRewardBlock, block.number);
            uint256 reward = multiplier * rewardPerBlock;
            totalLocked = totalLocked + reward;
        }
        return (TOKEN_UNIT * totalLocked) / totalShares;
    }

    ///@dev Returns the amount of share TOKENs received when exchanging `_amount` stake TOKENs.
    ///@dev Formula: stakeIn/shareOut = totalLocked/totalShares
    function toShare(uint256 _amount) public view returns (uint256) {
        uint256 totalLocked = IERC20(stakeToken).balanceOf(address(this));
        uint256 totalShares = totalSupply();
        if (totalLocked == 0 || totalShares == 0) {
            return _amount;
        }

        return (_amount * totalShares / totalLocked);
    }

    ///@dev Returns the amount of stake TOKENs received when exchanging `_shares` share TOKENs.
    ///@dev Formula: stakeIn/shareOut = totalLocked/totalShares
    function toStakeToken(uint256 _shares, uint256 _duration) public view returns (uint256, uint256) {
        uint256 totalLocked = IERC20(stakeToken).balanceOf(address(this));
        uint256 totalShares = totalSupply();
        if (totalShares == 0 || _shares == 0) {
            return (0, 0);
        }

        uint256 expectedAmount = (_shares * totalLocked / totalShares);
        return (expectedAmount, (expectedAmount / 2) + expectedAmount * (_duration - minDurationLock) / exchangeRateDivisor);
    }

    
    ///@dev Sets new value for `rewardPerBlock` state variable.
    ///@dev Only callable by ơwner.
    function setRewardPerBlock(uint256 _rewardPerBlock) public {
        rewardPerBlock = _rewardPerBlock;
        emit RewardPerBlockChanged(_msgSender(), _rewardPerBlock);
    }

    ///@dev Sets new value for `minDurationLock` state variable.
    ///@dev Only callable by owner.
    function setMinDurationLock(uint256 _minDurationLock) external onlyOwner {
        require(_minDurationLock != minDurationLock, "IDENTICAL");
        require(_minDurationLock < maxDurationLock, "DURATION_TOO_HIGH");
    
        minDurationLock = _minDurationLock;
        exchangeRateDivisor = (maxDurationLock - minDurationLock) * 2;
    }

    ///@dev Sets new value for `maxDurationLock` state variable.
    ///@dev Only callable by owner.
    function setMaxDurationLock(uint256 _maxDurationLock) external onlyOwner {
        require(_maxDurationLock != maxDurationLock, "IDENTICAL");
        require(_maxDurationLock > minDurationLock, "DURATION_TOO_LOW");
    
        maxDurationLock = _maxDurationLock;
        exchangeRateDivisor = (maxDurationLock - minDurationLock) * 2;
    }

    ///@dev Sets new value for `emergency` state variable.
    ///@dev Only callable by owner.
    function setEmergency(bool _emergency) external onlyOwner {
        require(emergency != _emergency, "IDENTICAL");

        emergency = _emergency;
    }

    ///@dev Updates reward variables of the staking pool to be up-to-date.
    function harvest() public {
        uint256 _lastRewardBlock = lastRewardBlock; //gas saving
        if (block.number <= _lastRewardBlock) {
            return;
        }

        uint256 totalLocked = IERC20(stakeToken).balanceOf(address(this));
        if (totalLocked == 0) {
            lastRewardBlock = block.number;
            return;
        }

        uint256 multiplier = getMultiplier(_lastRewardBlock, block.number);
        uint256 reward = multiplier * rewardPerBlock;
        if (reward > 0) {
            vault.claim(reward);
        }
        lastRewardBlock = block.number;
    }

    ///@dev Allocate pool rewards.
    ///@dev The variable `rewardPerBlock` will be updated every time this function is called
    ///@dev Only callable by owner.
    function allocate(uint256 _amount) external onlyOwner {
        require(_amount > 0, "BAD_AMOUNT");
		// Perfrom harvest the pool's pending rewards to be up-to-date.
		harvest();
		IERC20(stakeToken).safeTransferFrom(_msgSender(), address(vault), _amount);
		_sync();
	}

    ///@dev Extend the operational time of the pool by `_numBlocks` blocks.
    ///@dev Only callable by owner.
    function extend(uint256 _numBlocks) external onlyOwner {
        harvest();
        require(IERC20(stakeToken).balanceOf(address(vault)) > 0, "INSUFFICIENT_REWARD");
        
        endBlock = endBlock + _numBlocks;
        _sync();
    }

    ///@dev Enter the pool. Pay some TOKENs. Earn some shares.
    function enter(uint256 _amount) external {
        require(!emergency, "EMERGENCY_STATE");
        require(_amount > 0, "BAD_AMOUNT");

        harvest();

        uint256 shares = toShare(_amount);
        _mint(_msgSender(), shares);
        IERC20(stakeToken).transferFrom(_msgSender(), address(this), _amount);
        emit Enter(_msgSender(), _amount);
    }

    ///@dev Leave the pool. Leaving the pool does not mean receiving TOKENs immediately, it will be locked in `duration`.
    ///@notice Locked tokens will still earn the same as unlocked TOKENs.
    ///@notice There is truly no difference between them.
    function leave(uint256 _shares, uint256 _duration) external {
        require(_shares > 0, "BAD_AMOUNT");
        require(_duration >= minDurationLock, "DURATION_TOO_LOW");
        require(_duration <= maxDurationLock, "DURATION_TOO_HIGH");

        if (!emergency) {
            harvest();
        }

        //Share tokens will be locked in the contract
        //These tokens will still earn the same rewards as non-locked tokens, there is no difference between them
        uint256 lockIndex = _createLockFor(_msgSender(), _shares, _duration);
        _transfer(_msgSender(), address(this), _shares);

        emit Leave(_msgSender(), _shares, lockIndex);
    }

    ///@dev Cancel the `lockIndex` lock.
    function cancelLock(uint256 lockIndex) external {
        Lock memory lock = _destroyLock(lockIndex, true);
        _transfer(address(this), _msgSender(), lock.amount);

        emit Cancel(_msgSender(), lockIndex);
    }

    ///@dev Release the `lockIndex` lock. Claim back your TOKENs.
    function releaseLock(uint256 lockIndex) external {
        //In an emergency state, the cancel lock function must be called instead of this function
        require(!emergency, "EMERGENCY_STATE");

        harvest();

        Lock memory lock = _destroyLock(lockIndex, false);

        (uint256 expected, uint256 got) = toStakeToken(lock.amount, lock.duration);
        if (expected > got) {
            ERC20Burnable(stakeToken).burn(expected - got);
        }
        if (got > 0) {
            IERC20(stakeToken).safeTransfer(_msgSender(), got);
        }
        _burn(address(this), lock.amount);

        emit Release(_msgSender(), lockIndex);
    }

    ///@dev Creates a lock to hold the amount of share tokens when a user requests to leave the pool.
    function _createLockFor(address _to, uint256 _amount, uint256 _duration) internal returns (uint256) {
        uint256 lockId = _lockIdTracker;
        Lock memory newLock = Lock({
            id: lockId,
            amount: _amount,
            duration: _duration,
            unlockedAt: block.timestamp + _duration
        });

        _lockedBalances[_to] = _lockedBalances[_to] + _amount;
        _ownedLocks[_to].push(lockId);
        _allLocksIndex[lockId] = _allLocks.length;
        _allLocks.push(newLock);

        _lockIdTracker++;

        return lockId;
    }

    function _unsafeAccessLock(address account, uint256 index) internal view returns (Lock memory) {
        uint256 lockId = _ownedLocks[account][index];
        uint256 lockIndex = _allLocksIndex[lockId];
        return _allLocks[lockIndex];
    }

    function _destroyLock(uint256 lockIndex, bool lte) internal returns (Lock memory) {
        uint256[] storage ownedLocks = _ownedLocks[_msgSender()];
        uint256 numOwnedLocks = ownedLocks.length;
        require(numOwnedLocks > 0 && lockIndex < numOwnedLocks, "OUT_OF_BOUNDS_INDEX");
    
        Lock memory lock = _unsafeAccessLock(_msgSender(), lockIndex);
        if (lte) {
            require(block.timestamp < lock.unlockedAt, "LOCK_EXPIRED");
        } else {
            require(block.timestamp > lock.unlockedAt, "UNEXPIRED");
        }

        uint256 lastLockIndex = numOwnedLocks - 1;
        if (lockIndex != lastLockIndex) {
            uint256 lastLockId = ownedLocks[lastLockIndex];
            ownedLocks[lockIndex] = lastLockId;
        }
        ownedLocks.pop();

        _removeLockFromAllLocksEnumeration(lock.id);
        _lockedBalances[_msgSender()] -= lock.amount;
        
        return lock;
    }

    function _removeLockFromAllLocksEnumeration(uint256 lockId) internal {
        uint256 lastLockIndex = _allLocks.length - 1;
        uint256 lockIndex = _allLocksIndex[lockId];

        Lock memory lastLock = _allLocks[lastLockIndex];

        if (lastLockIndex != lockIndex) {
            _allLocks[lockIndex] = lastLock;
            _allLocksIndex[lastLock.id] = lockIndex;
        }

        delete _allLocksIndex[lockId];
        _allLocks.pop();
    }

    ///@dev Recalculate the 'rewardPerBlock' variable based on the available rewards in the vault and the operational time of the pool."
    function _sync() internal {
		uint256 availableReward = IERC20(stakeToken).balanceOf(address(vault));
		uint256 _lastRewardBlock = lastRewardBlock;
		uint256 _endBlock = endBlock;
		
		uint256 newRewardPerBlock = 0;
		if (_endBlock > _lastRewardBlock && availableReward > 0) {
			newRewardPerBlock = availableReward / (_endBlock - _lastRewardBlock);
		}
		setRewardPerBlock(newRewardPerBlock);
	}

   
    ///@dev Refunds the `amount` of stake TOKENs for `_to`.
    ///@dev Safe transfer function, just in case if rounding error causes pool to not have enough TOKENs.
    function _safeRefund(address _to, uint256 _amount) internal {
        uint256 balance = IERC20(stakeToken).balanceOf(address(this));
        if (_amount > balance) {
            IERC20(stakeToken).safeTransfer(_to, balance);
        } else {
            IERC20(stakeToken).safeTransfer(_to, _amount);
        }
    }
}
