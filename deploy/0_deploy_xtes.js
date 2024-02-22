module.exports = async function ({ getNamedAccounts, deployments }) {
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  await deploy("xTES", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [
      process.env.STAKE_TOKEN_ADDRESS,
      process.env.START_BLOCK,
      process.env.END_BLOCK,
      process.env.MIN_DURATION_LOCK,
      process.env.MAX_DURATION_LOCK,
    ],
  });
};

module.exports.tags = ["xTES"];
