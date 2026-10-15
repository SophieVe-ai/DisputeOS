// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DisputeOS AuditLog
/// @notice Append-only, hash-chained anchor for DisputeOS agent and approval logs.
/// There is deliberately no function to edit or delete an entry: once anchored,
/// an agent's action record is immutable. Each entry must link to the current head.
contract AuditLog {
    struct Entry {
        bytes32 entryHash;
        bytes32 prevHash;
        bytes32 caseKey;
        uint64 timestamp;
        address writer;
        string actor;
        string action;
    }

    address public immutable owner;
    mapping(address => bool) public writers;

    Entry[] private entries;
    mapping(bytes32 => uint256) private positionOf; // index + 1, 0 = absent

    event WriterSet(address indexed writer, bool allowed);
    event EntryAnchored(
        uint256 indexed index,
        bytes32 indexed caseKey,
        bytes32 entryHash,
        bytes32 prevHash,
        string actor,
        string action,
        address writer
    );

    error NotOwner();
    error NotWriter();
    error DuplicateEntry(bytes32 entryHash);
    error BrokenChain(bytes32 expectedPrev, bytes32 providedPrev);
    error InvalidRange();

    constructor() {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit WriterSet(msg.sender, true);
    }

    function setWriter(address writer, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        writers[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function append(
        bytes32 entryHash,
        bytes32 prevHash,
        bytes32 caseKey,
        string calldata actor,
        string calldata action
    ) external returns (uint256 index) {
        if (!writers[msg.sender]) revert NotWriter();
        if (positionOf[entryHash] != 0) revert DuplicateEntry(entryHash);
        bytes32 currentHead = head();
        if (prevHash != currentHead) revert BrokenChain(currentHead, prevHash);

        index = entries.length;
        entries.push(Entry(entryHash, prevHash, caseKey, uint64(block.timestamp), msg.sender, actor, action));
        positionOf[entryHash] = index + 1;
        emit EntryAnchored(index, caseKey, entryHash, prevHash, actor, action, msg.sender);
    }

    function count() external view returns (uint256) {
        return entries.length;
    }

    function head() public view returns (bytes32) {
        return entries.length == 0 ? bytes32(0) : entries[entries.length - 1].entryHash;
    }

    function getEntry(uint256 index) external view returns (Entry memory) {
        return entries[index];
    }

    function indexOf(bytes32 entryHash) external view returns (bool found, uint256 index) {
        uint256 pos = positionOf[entryHash];
        return pos == 0 ? (false, 0) : (true, pos - 1);
    }

    function hashesInRange(uint256 from, uint256 to) external view returns (bytes32[] memory out) {
        if (from > to || to > entries.length) revert InvalidRange();
        out = new bytes32[](to - from);
        for (uint256 i = from; i < to; i++) {
            out[i - from] = entries[i].entryHash;
        }
    }
}
