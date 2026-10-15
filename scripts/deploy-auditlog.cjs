// Deploys AuditLog and records the address in .chain/deployment.json for the app.
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractFactory("AuditLog");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const network = await hre.ethers.provider.getNetwork();
  const out = {
    address,
    chainId: network.chainId.toString(),
    network: hre.network.name,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, "..", ".chain", "deployment.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`AuditLog deployed to ${address} on ${hre.network.name} (chainId ${out.chainId})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
