require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const testnetUrl = process.env.TESTNET_RPC_URL;
const testnetKey = process.env.LEDGER_PRIVATE_KEY;

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./contracts",
    tests: "./contract-tests",
    cache: "./.chain/cache",
    artifacts: "./.chain/artifacts",
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(testnetUrl && testnetKey
      ? { testnet: { url: testnetUrl, accounts: [testnetKey] } }
      : {}),
  },
};
