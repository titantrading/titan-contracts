const { ethers } = require("hardhat")

export async function getBlockCount() {
  return await ethers.provider.getBlockNumber()
}

export async function now() {
  const { timestamp } = await ethers.provider.getBlock();
  return timestamp;
}

export async function blockIncreaseTime(times) {
  await ethers.provider.send("evm_increaseTime", [times])
  await ethers.provider.send("evm_mine") // this one will have 02:00 PM as its timestamp
}

export async function advanceBlock() {
  return ethers.provider.send("evm_mine", [])
}

export async function advanceBlockTo(blockNumber) {
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock()
  }
}