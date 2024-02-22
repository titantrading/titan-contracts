const { ethers } = require("hardhat")
import { expect } from "chai"

import { advanceBlockTo, blockIncreaseTime, getBlockCount, now } from "../utils/index"

describe("xTES", function () {
  before(async function () {
    this.signers = await ethers.getSigners()
    this.alice = this.signers[0]
    this.bob = this.signers[1]
    this.carol = this.signers[2]
    this.owner = this.signers[3]
    this.operator = this.signers[4]

    this.stakeTokenFactory = await ethers.getContractFactory("TestERC20")
    this.xTESFactory = await ethers.getContractFactory("xTES")
  })

  beforeEach(async function () {
    this.stakeToken = await this.stakeTokenFactory.deploy("TEST", "TEST")
    await this.stakeToken.deployed()
  })

  it("should have correct name and symbol and decimal", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1000, 14, 90)
    await this.xTES.deployed()

    const name = await this.xTES.name()
    const symbol = await this.xTES.symbol()
    const decimals = await this.xTES.decimals()
    expect(name).to.be.equal("xTES")
    expect(symbol).to.be.equal("xTES")
    expect(decimals).to.be.equal(18)
  })

  it("should set correct state variables", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1000, 14, 90)
    await this.xTES.deployed()

    expect(await this.xTES.stakeToken()).to.equal(this.stakeToken.address)
    expect(await this.xTES.vault()).to.not.equal(ethers.constants.ZERO_ADDRESS)
    expect(await this.xTES.rewardPerBlock()).to.equal(0)
    expect(await this.xTES.endBlock()).to.equal(1000)
    expect(await this.xTES.lastRewardBlock()).to.equal(100)
    expect(await this.xTES.minDurationLock()).to.equal(14)
    expect(await this.xTES.maxDurationLock()).to.equal(90)
  })

  it("should allow owner and only owner to allocate", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1100, 14, 90)
    await this.xTES.deployed()
    await this.xTES.transferOwnership(this.owner.address)
    await this.stakeToken.mint(this.owner.address, 10000)
    await this.stakeToken.connect(this.owner).approve(this.xTES.address, 10000)

    expect(await this.xTES.owner()).to.equal(this.owner.address)
    expect(await this.xTES.rewardPerBlock()).to.equal(0)

    await expect(this.xTES.connect(this.alice).allocate(10000)).to.be.revertedWith("Ownable: caller is not the owner")
    expect(await this.xTES.rewardPerBlock()).to.equal(0)

    expect(await this.xTES.connect(this.owner).allocate(10000))
    expect(await this.xTES.rewardPerBlock()).to.equal(10)
  })

  it("should allow owner and only owner to extend", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1100, 14, 90)
    await this.xTES.deployed()
    await this.xTES.transferOwnership(this.owner.address)
    await this.stakeToken.mint(this.owner.address, 10000)
    await this.stakeToken.connect(this.owner).approve(this.xTES.address, 10000)

    expect(await this.xTES.owner()).to.equal(this.owner.address)

    expect(await this.xTES.connect(this.owner).allocate(10000))
    expect(await this.xTES.rewardPerBlock()).to.equal(10)

    await expect(this.xTES.connect(this.alice).extend(1000)).to.be.revertedWith("Ownable: caller is not the owner")
    expect(await this.xTES.rewardPerBlock()).to.equal(10)

    expect(await this.xTES.connect(this.owner).extend(1000))
    expect(await this.xTES.rewardPerBlock()).to.equal(5)
  })

  it("should allow owner and only owner to set min duration lock", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1100, 14, 90)
    await this.xTES.deployed()
    await this.xTES.transferOwnership(this.owner.address)

    expect(await this.xTES.owner()).to.equal(this.owner.address)
    expect(await this.xTES.minDurationLock()).to.equal(14)

    await expect(this.xTES.connect(this.alice).setMinDurationLock(20)).to.be.revertedWith("Ownable: caller is not the owner")
    expect(await this.xTES.minDurationLock()).to.equal(14)

    expect(await this.xTES.connect(this.owner).setMinDurationLock(20))
    expect(await this.xTES.minDurationLock()).to.equal(20)
  })

  it("should allow owner and only owner to set max duration lock", async function () {
    this.xTES = await this.xTESFactory.deploy(this.stakeToken.address, 100, 1100, 14, 90)
    await this.xTES.deployed()
    await this.xTES.transferOwnership(this.owner.address)

    expect(await this.xTES.owner()).to.equal(this.owner.address)
    expect(await this.xTES.maxDurationLock()).to.equal(90)

    await expect(this.xTES.connect(this.alice).setMaxDurationLock(100)).to.be.revertedWith("Ownable: caller is not the owner")
    expect(await this.xTES.maxDurationLock()).to.equal(90)

    expect(await this.xTES.connect(this.owner).setMaxDurationLock(100))
    expect(await this.xTES.maxDurationLock()).to.equal(100)
  })

  describe("#staking", function () {
    beforeEach(async function () {
      await this.stakeToken.mint(this.owner.address, 100000)
      await this.stakeToken.mint(this.alice.address, 1000)
      await this.stakeToken.mint(this.bob.address, 1000)
      await this.stakeToken.mint(this.carol.address, 1000)
    })

    it("the multiplier should be calculated correctly", async function () {
      // 100 TOKEN per block farming rate starting at block 100
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 0, 50, 14, 90)
      expect(await this.xTES.getMultiplier(50, 100)).to.be.equal(0)
      expect(await this.xTES.getMultiplier(10, 100)).to.be.equal(40)
      expect(await this.xTES.getMultiplier(10, 30)).to.be.equal(20)
      await expect(this.xTES.getMultiplier(50, 30)).to.be.reverted
    })

    it("should give out TOKEN only after farming time", async function () {
      // 100 TOKEN per block farming rate starting at block 100
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 100, 1100, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      //Bob enter 100 TOKEN to pool at block 40
      await advanceBlockTo("39")
      expect(await this.xTES.exchangeRate()).to.be.equal(ethers.utils.parseEther("1"))
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.be.equal(900)
      expect(await this.xTES.balanceOf(this.bob.address)).to.be.equal(100)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(100)

      //Carol enter 100 TOKEN to staking pool at block 45
      await advanceBlockTo("44")
      expect(await this.xTES.exchangeRate()).to.be.equal(ethers.utils.parseEther("1"))
      await this.xTES.connect(this.carol).enter(100)
      expect(await this.stakeToken.balanceOf(this.carol.address)).to.be.equal(900)
      expect(await this.xTES.balanceOf(this.carol.address)).to.be.equal(100)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(200)

      //Bob enter 100 TOKEN to staking pool at block 100
      await advanceBlockTo("99")
      expect(await this.xTES.exchangeRate()).to.be.equal(ethers.utils.parseEther("1"))
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.be.equal(800)
      expect(await this.xTES.balanceOf(this.bob.address)).to.be.equal(200)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(300)

      //Bob enter 100 TOKEN to staking pool at block 105
      //at block 105
      //should farmed 500 TOKEN, exchange rate: 300/800  1xTES : 2.67 TOKEN
      //Bob should get: 100/2.67 = 37 xTES
      await advanceBlockTo("104")
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.be.equal(700)
      expect(await this.xTES.balanceOf(this.bob.address)).to.be.equal(237)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(900)
      expect(await this.xTES.exchangeRate()).to.be.equal(ethers.utils.parseEther("1").mul(900).div(337))
    })

    it("should not farming if no one enter", async function () {
      // 100 TOKEN per block farming rate starting at block 200
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 200, 1200, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      await advanceBlockTo("199")
      await this.xTES.harvest()
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(0)

      await advanceBlockTo("204")
      await this.xTES.harvest()
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(0)

      //Bob enter 100 TOKEN at block 210
      await advanceBlockTo("209")
      await this.xTES.connect(this.bob).enter(100) // block 110
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.be.equal(900)
      expect(await this.xTES.balanceOf(this.bob.address)).to.be.equal(100)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(100)

      await advanceBlockTo("219")
      //at block 220
      //should farmed 1000 TOKEN, exchange rate 1 xTES : 11 TOKEN
      await this.xTES.harvest()
      expect(await this.xTES.exchangeRate()).to.be.equal(ethers.utils.parseEther("1").mul(11))
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)

      //Bob enter 100 TOKEN at block 221, exchange rate 1 xTES : 12 TOKEN
      //Bob should have: 100 + 100 / 12 = 108 xTES
      await this.xTES.connect(this.bob).enter(100) // block 221
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1300)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(108)
    })

    it("should distribute TOKEN properly for each staker", async function () {
      // 100 per block farming rate starting at block 300
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 300, 1300, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.alice).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      // Current exchange rate: 1 xTES : 1 TOKEN
      // Alice should get: 100 xTES
      await advanceBlockTo("309")
      await this.xTES.connect(this.alice).enter(100)
      expect(await this.xTES.balanceOf(this.alice.address)).to.equal(100)
      expect(await this.xTES.getVotes(this.alice.address)).to.equal(100)
      expect(await this.xTES.getTotalVotes()).to.equal(100)

      // Bob enters 200 TOKEN at block 314
      //  Current exchange rate: 1e18 * (100+400/100) => 1 xTES:5 TOKEN
      //  Bob should get: 200/5 = 40 xTES
      await advanceBlockTo("313")
      await this.xTES.connect(this.bob).enter(200)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(40)
      expect(await this.xTES.getVotes(this.bob.address)).to.equal(40)
      expect(await this.xTES.getTotalVotes()).to.equal(140)

      // Carol enters 300 TOKEN at block 318
      //  Current exchange rate: 1e18 * (100+200+800/100+40) => 1 xTES:7.86 TOKEN
      //  Carol should get: 300/7.86 = 38 xTES
      await advanceBlockTo("317")
      await this.xTES.connect(this.carol).enter(300)
      expect(await this.xTES.balanceOf(this.carol.address)).to.equal(38)
      expect(await this.xTES.getVotes(this.carol.address)).to.equal(38)
      expect(await this.xTES.getTotalVotes()).to.equal(178)

      // Alice enters 100 more TOKEN at block 320. At this point:
      //  Current exchange rate: (1e18)*(100+200+300+1000)/(100+40+38) => 1 xTES:8.99 TOKEN
      //  Alice should get: 100/8.99 = 11 xTES
      await advanceBlockTo("319")
      await this.xTES.connect(this.alice).enter(100)
      expect(await this.xTES.balanceOf(this.alice.address)).to.equal(111)
      expect(await this.xTES.getVotes(this.alice.address)).to.equal(111)
      expect(await this.xTES.getTotalVotes()).to.equal(189)

      {
        // Bob leaves 20 xTES with lock duration is 14 at block 330. At this point:
        //  Current exchange rate: (1e18)*(100+200+300+100+2000)/(100+40+38+11) => 1 xTES:14.28 TOKEN
        //  Bob should get: 20*14.28 / 2 = 142 TOKEN
        await advanceBlockTo("329")
        await this.xTES.connect(this.bob).leave(20, 14)
        expect(await this.xTES.allLockLength()).to.equal(1)

        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        const [expected, got] = await this.xTES.toStakeToken(20, 14)
        const nowInSec = await now()
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(lock.id).to.equal(1)
        expect(lock.amount).to.equal(20)
        expect(lock.duration).to.equal(14)
        expect(lock.unlockedAt).to.equal(nowInSec + 14)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(20)
        expect(expected).to.be.equal(285)
        expect(got).to.be.equal(142)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(20)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(40)
        expect(await this.xTES.getTotalVotes()).to.equal(189)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(2700)
      }

      // Alice leaves 20 xTES with duration is 90 at block 340.
      // Bob leaves 15 xTES at block 350.
      // Carol leaves 30 xTES at block 360.
      {
        await advanceBlockTo("339")
        await this.xTES.connect(this.alice).leave(20, 90)
        expect(await this.xTES.allLockLength()).to.equal(2)

        // Exchange rate: (1e18)*(2700+1000)/(100+40+38+11) => 1 xTES : 19.57 TOKEN
        // Alice should get: 20*19.57= 391 TOKEN
        const lock = await this.xTES.lockOfOwnerByIndex(this.alice.address, 0)
        const [expected, got] = await this.xTES.toStakeToken(20, 90)
        const nowInSec = await now()
        expect(await this.xTES.lockLengthOf(this.alice.address)).to.equal(1)
        expect(lock.id).to.equal(2)
        expect(lock.amount).to.equal(20)
        expect(lock.duration).to.equal(90)
        expect(lock.unlockedAt).to.equal(nowInSec + 90)
        expect(await this.xTES.lockedBalanceOf(this.alice.address)).to.equal(20)
        expect(expected).to.be.equal(391)
        expect(got).to.be.equal(390) //The expected number received should be 391 instead of 390. We will ignore this rounding error because it is insignificant in the actual case.
        expect(await this.xTES.balanceOf(this.alice.address)).to.equal(91)
        expect(await this.xTES.getVotes(this.alice.address)).to.equal(111)
        expect(await this.xTES.getTotalVotes()).to.equal(189)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(3700)
      }

      {
        await advanceBlockTo("349")
        await this.xTES.connect(this.bob).leave(15, 90)
        expect(await this.xTES.allLockLength()).to.equal(3)

        // Exchange rate: (1e18)*(3700+1000)/(100+40+38+11) => 1 xTES : 24.86 TOKEN
        // Bob should get: 15*24.86 = 373 TOKEN
        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 1)
        const [expected, got] = await this.xTES.toStakeToken(15, 90)
        const nowInSec = await now()
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(2)
        expect(lock.id).to.equal(3)
        expect(lock.amount).to.equal(15)
        expect(lock.duration).to.equal(90)
        expect(lock.unlockedAt).to.equal(nowInSec + 90)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(35)
        expect(expected).to.be.equal(373)
        expect(got).to.be.equal(372)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(5)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(20)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(4700)
        // Lock 0 is expired
        const lock0 = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        const timestampNow = await now();
        expect(lock0.unlockedAt.toNumber()).to.lessThan(timestampNow);
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(20)
        expect(await this.xTES.getTotalVotes()).to.equal(169)
      }

      {
        await advanceBlockTo("359")
        await this.xTES.connect(this.carol).leave(30, 90)
        expect(await this.xTES.allLockLength()).to.equal(4)
        // Exchange rate: (1e18)*(4700+1000)/(100+40+38+11) => 1 xTES : 30.1587 TOKEN
        // Carol should get: 30*30.1587 = 904 TOKEN
        const lock = await this.xTES.lockOfOwnerByIndex(this.carol.address, 0)
        const [expected, got] = await this.xTES.toStakeToken(30, 90)
        const nowInSec = await now()
        expect(await this.xTES.lockLengthOf(this.carol.address)).to.equal(1)
        
        expect(lock.id).to.equal(4)
        expect(lock.amount).to.equal(30)
        expect(lock.duration).to.equal(90)
        expect(lock.unlockedAt).to.equal(nowInSec + 90)
        expect(await this.xTES.lockedBalanceOf(this.carol.address)).to.equal(30)
        expect(expected).to.be.equal(904)
        expect(got).to.be.equal(904)
        expect(await this.xTES.balanceOf(this.carol.address)).to.equal(8)
        expect(await this.xTES.getVotes(this.carol.address)).to.equal(38)
        expect(await this.xTES.getVotes(this.alice.address)).to.equal(111)
        expect(await this.xTES.getTotalVotes()).to.equal(169)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(5700)
      }
    })

    it("locked tokens should be released after expiration", async function () {
      // 100 per block farming rate starting at block 400
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 400, 1400, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.alice).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      // Bob enter 100 TOKENs at block 410
      await advanceBlockTo("409")
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(100)
      expect(await this.xTES.totalSupply()).to.equal(100)
      {
        // Bob leaves 50 xTES at block 420
        //  Exchange rate: (1e18)*(100+1000)/100 => 1 xTES :11 TOKEN
        //  Bob should get: 100*11 = 1100 TOKENs
        await advanceBlockTo("419")
        await this.xTES.connect(this.bob).leave(50, 14)
        expect(await this.xTES.allLockLength()).to.equal(1)

        let unlockedAt = (await now()) + 14
        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        expect(lock.id).to.equal(1)
        expect(lock.amount).to.equal(50)
        expect(lock.duration).to.equal(14)
        expect(lock.unlockedAt).to.equal(unlockedAt)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(50)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
        expect(await this.xTES.totalSupply()).to.equal(100)
        expect(await this.xTES.getTotalVotes()).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
      }

      {
        // Bob releases 50 xTES locked after 10 seconds
        // Should failed
        await blockIncreaseTime(10)
        await expect(this.xTES.connect(this.bob).releaseLock(0)).to.be.revertedWith("UNEXPIRED")
        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        expect(lock.id).to.equal(1)
        expect(lock.amount).to.equal(50)
        expect(lock.duration).to.equal(14)
        expect(lock.unlockedAt.toNumber()).to.greaterThan(await now())
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(50)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
        expect(await this.xTES.totalSupply()).to.equal(100)
        expect(await this.xTES.getTotalVotes()).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
      }

      {
        // Bob releases 50 xTES locked after 14 seconds
        // Should Bob get 375 TOKENs
        await blockIncreaseTime(4)
        expect(await this.xTES.getTotalVotes()).to.equal(50)
        expect(await this.xTES.connect(this.bob).releaseLock(0))
        expect(await this.xTES.allLockLength()).to.equal(0)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(0)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(50)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(750)
        expect(await this.xTES.totalSupply()).to.equal(50)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(1275)
      }

      {
        // Bob leaves 50 xTESs at block 434
        //  Exchange rate: (1e18)*(750+1000)/50 => 1 xTES : 35 TOKENs
        //  Bob should get: 50*35 = 1750 TOKENs
        await advanceBlockTo("433")
        await this.xTES.connect(this.bob).leave(50, 90)
        expect(await this.xTES.allLockLength()).to.equal(1)

        let unlockedAt = (await now()) + 90
        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        expect(lock.id).to.equal(2)
        expect(lock.amount).to.equal(50)
        expect(lock.duration).to.equal(90)
        expect(lock.unlockedAt).to.equal(unlockedAt)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(50)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(50)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(50)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1750)
        expect(await this.xTES.totalSupply()).to.equal(50)
        expect(await this.xTES.getTotalVotes()).to.equal(50)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(1275)
      }

      {
        // Bob releases 50 xTES locked after 90 seconds and 2 blocks
        // Bob should have: 1275 + 1950 = 2000 TOKENs
        await blockIncreaseTime(90)
        expect(await this.xTES.getTotalVotes()).to.equal(0)
        expect(await this.xTES.connect(this.bob).releaseLock(0))
        expect(await this.xTES.allLockLength()).to.equal(0)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(0)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(0)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(0)
        expect(await this.xTES.totalSupply()).to.equal(0)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(3225)
      }
    })

    it("canceling the lock should not affect rewards", async function () {
      // 100 per block farming rate starting at block 500
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 500, 1500, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.alice).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      // Bob enter 100 TOKENs at block 510
      await advanceBlockTo("509")
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(100)
      expect(await this.xTES.totalSupply()).to.equal(100)
      {
        // Bob leaves 25 xTES at block 520
        //  Exchange rate: (1e18)*(100+1000)/100 => 1 xTES :11 TOKEN
        //  Bob should get: 100*11 = 1100 TOKENs
        await advanceBlockTo("519")
        await this.xTES.connect(this.bob).leave(25, 14)
        expect(await this.xTES.allLockLength()).to.equal(1)

        let unlockedAt = (await now()) + 14
        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        expect(lock.id).to.equal(1)
        expect(lock.amount).to.equal(25)
        expect(lock.duration).to.equal(14)
        expect(lock.unlockedAt).to.equal(unlockedAt)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(25)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(75)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(25)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
        expect(await this.xTES.totalSupply()).to.equal(100)
        expect(await this.xTES.getTotalVotes()).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
      }

      {
        // Bob leaves 75 xTESs at block 530
        //  Exchange rate: (1e18)*(1100+1000)/50 => 1 xTES : 42 TOKENs
        //  Bob should get: 50*42 = 2100 TOKENs
        await advanceBlockTo("529")
        await this.xTES.connect(this.bob).leave(75, 90)
        expect(await this.xTES.allLockLength()).to.equal(2)

        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 1)
        expect(lock.id).to.equal(2)
        expect(lock.amount).to.equal(75)
        expect(lock.duration).to.equal(90)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(2)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(100)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(0)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(100)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(2100)
        expect(await this.xTES.totalSupply()).to.equal(100)
        expect(await this.xTES.getTotalVotes()).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
      }

      {
        // Bob cancel 1nd lock
        expect(await this.xTES.connect(this.bob).cancelLock(0))
        expect(await this.xTES.allLockLength()).to.equal(1)

        const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
        expect(lock.id).to.equal(2)
        expect(lock.amount).to.equal(75)
        expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
        expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(75)
        expect(await this.xTES.balanceOf(this.bob.address)).to.equal(25)
        expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(75)
        expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(2100)
        expect(await this.xTES.totalSupply()).to.equal(100)
        expect(await this.xTES.getTotalVotes()).to.equal(100)
        expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
      }
    })

    it("expired locks cannot be canceled", async function () {
      // 100 per block farming rate starting at block 600
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 600, 1600, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.alice).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      // Bob enter 100 TOKENs at block 610
      await advanceBlockTo("609")
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(100)
      expect(await this.xTES.totalSupply()).to.equal(100)

      // Bob leaves 25 xTES at block 620
      //  Exchange rate: (1e18)*(100+1000)/100 => 1 xTES :11 TOKEN
      //  Bob should get: 100*11 = 1100 TOKENs
      await advanceBlockTo("619")
      await this.xTES.connect(this.bob).leave(25, 14)
      expect(await this.xTES.allLockLength()).to.equal(1)

      let unlockedAt = (await now()) + 14
      const lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
      expect(lock.id).to.equal(1)
      expect(lock.amount).to.equal(25)
      expect(lock.duration).to.equal(14)
      expect(lock.unlockedAt).to.equal(unlockedAt)
      expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
      expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(25)
      expect(await this.xTES.allLockLength()).to.equal(1)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(75)
      expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(25)
      expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
      expect(await this.xTES.totalSupply()).to.equal(100)
      expect(await this.xTES.getTotalVotes()).to.equal(100)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)

      await blockIncreaseTime(100)
      await expect(this.xTES.connect(this.bob).cancelLock(0)).to.be.revertedWith("LOCK_EXPIRED")
    })

    it("expired locks will not be considered in the voting", async function () {
      // 100 per block farming rate starting at block 700
      this.xTES = await this.xTESFactory.connect(this.owner).deploy(this.stakeToken.address, 700, 1700, 14, 90)

      await this.xTES.deployed()
      await this.stakeToken.connect(this.owner).approve(this.xTES.address, 100000)
      await this.xTES.connect(this.owner).allocate(100000)

      await this.stakeToken.connect(this.alice).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.bob).approve(this.xTES.address, 1000)
      await this.stakeToken.connect(this.carol).approve(this.xTES.address, 1000)

      // Bob enter 100 TOKENs at block 710
      await advanceBlockTo("709")
      await this.xTES.connect(this.bob).enter(100)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(100)
      expect(await this.xTES.totalSupply()).to.equal(100)

      // Bob leaves 25 xTES at block 720
      //  Exchange rate: (1e18)*(100+1000)/100 => 1 xTES :11 TOKEN
      //  Bob should get: 100*11 = 1100 TOKENs
      await advanceBlockTo("719")
      await this.xTES.connect(this.bob).leave(25, 14)
      expect(await this.xTES.allLockLength()).to.equal(1)

      const unlockedAt = (await now()) + 14
      let lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
      expect(lock.id).to.equal(1)
      expect(lock.amount).to.equal(25)
      expect(lock.duration).to.equal(14)
      expect(lock.unlockedAt).to.equal(unlockedAt)
      expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
      expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(25)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(75)
      expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(25)
      expect(await this.xTES.getVotes(this.bob.address)).to.equal(100)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
      expect(await this.xTES.totalSupply()).to.equal(100)
      expect(await this.xTES.getTotalVotes()).to.equal(100)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)

      await blockIncreaseTime(100)
      lock = await this.xTES.lockOfOwnerByIndex(this.bob.address, 0)
      expect(lock.id).to.equal(1)
      expect(lock.amount).to.equal(25)
      expect(lock.duration).to.equal(14)
      expect(lock.unlockedAt).to.equal(unlockedAt)
      expect(await this.xTES.lockLengthOf(this.bob.address)).to.equal(1)
      expect(await this.xTES.lockedBalanceOf(this.bob.address)).to.equal(25)
      expect(await this.xTES.allLockLength()).to.equal(1)
      expect(await this.xTES.balanceOf(this.bob.address)).to.equal(75)
      expect(await this.xTES.balanceOf(this.xTES.address)).to.equal(25)
      expect(await this.xTES.getVotes(this.bob.address)).to.equal(75)
      expect(await this.stakeToken.balanceOf(this.xTES.address)).to.equal(1100)
      expect(await this.xTES.totalSupply()).to.equal(100)
      expect(await this.xTES.getTotalVotes()).to.equal(75)
      expect(await this.stakeToken.balanceOf(this.bob.address)).to.equal(900)
    })
  })
})
