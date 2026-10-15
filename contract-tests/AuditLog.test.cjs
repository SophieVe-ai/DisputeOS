const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroHash;
const h = (s) => ethers.id(s);

describe("AuditLog", () => {
  async function deploy() {
    const [owner, outsider] = await ethers.getSigners();
    const log = await (await ethers.getContractFactory("AuditLog")).deploy();
    return { log, owner, outsider };
  }

  it("appends hash-chained entries and emits events", async () => {
    const { log } = await deploy();
    await expect(log.append(h("a"), ZERO, h("case-1"), "agent:evidence", "evidence.completed"))
      .to.emit(log, "EntryAnchored");
    await log.append(h("b"), h("a"), h("case-1"), "agent:challenge", "challenge.completed");
    expect(await log.count()).to.equal(2n);
    expect(await log.head()).to.equal(h("b"));
    expect(await log.hashesInRange(0, 2)).to.deep.equal([h("a"), h("b")]);
    const [found, index] = await log.indexOf(h("b"));
    expect(found).to.equal(true);
    expect(index).to.equal(1n);
  });

  it("rejects entries that do not link to the current head", async () => {
    const { log } = await deploy();
    await log.append(h("a"), ZERO, h("case-1"), "agent:evidence", "x");
    await expect(log.append(h("b"), h("wrong"), h("case-1"), "agent:evidence", "y"))
      .to.be.revertedWithCustomError(log, "BrokenChain");
  });

  it("rejects duplicate entry hashes", async () => {
    const { log } = await deploy();
    await log.append(h("a"), ZERO, h("case-1"), "agent:evidence", "x");
    await expect(log.append(h("a"), h("a"), h("case-1"), "agent:evidence", "x"))
      .to.be.revertedWithCustomError(log, "DuplicateEntry");
  });

  it("only allows authorised writers (agents hold no key)", async () => {
    const { log, outsider } = await deploy();
    await expect(log.connect(outsider).append(h("a"), ZERO, h("c"), "agent:rogue", "x"))
      .to.be.revertedWithCustomError(log, "NotWriter");
    await expect(log.connect(outsider).setWriter(outsider.address, true))
      .to.be.revertedWithCustomError(log, "NotOwner");
  });

  it("exposes no mutation functions besides append and setWriter", async () => {
    const { log } = await deploy();
    const mutating = log.interface.fragments
      .filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
      .map((f) => f.name)
      .sort();
    expect(mutating).to.deep.equal(["append", "setWriter"]);
  });

  it("validates ranges", async () => {
    const { log } = await deploy();
    await expect(log.hashesInRange(0, 1)).to.be.revertedWithCustomError(log, "InvalidRange");
  });
});
