import { units } from "./unit";
class Node {
    constructor(id, neighbors, isGK) {
        this.id = id;
        this.neighbors = neighbors;
        this.isGK = isGK;
        this.occupants = new Set();
    }
    addOccupant(unitId) {
        this.occupants.add(unitId);
    }
    removeOccupant(unitId) {
        this.occupants.delete(unitId);
    }
    isEmpty() {
        return this.occupants.size === 0;
    }
    hasEnemy(ownPlayerId) {
        for (const occ of this.occupants) {
            if (!occ.startsWith(ownPlayerId))
                return true;
        }
        return false;
    }
}
// adjacency map
const adjacencyMap = {
    1: [2, 3],
    2: [1, 3, 4, 5],
    3: [1, 2, 5, 6],
    4: [2, 5, 7, 8],
    5: [2, 3, 4, 6, 7, 8, 9],
    6: [3, 5, 8, 9],
    7: [4, 5, 8, 10],
    8: [4, 5, 6, 7, 9, 10, 11],
    9: [5, 6, 8, 11],
    10: [7, 8, 11, 12],
    11: [8, 9, 10, 12],
    12: [10, 11],
};
// initialize nodes as a Map for O(1) lookup
const nodes = new Map();
for (let i = 1; i <= 12; i++) {
    const node = new Node(i, adjacencyMap[i], i === 1 || i === 12);
    nodes.set(i, node);
}
// helpers
function getNode(id) {
    return nodes.get(id);
}
function getNeighbors(id) {
    const node = getNode(id);
    if (!node)
        return [];
    return node.neighbors.map(nid => nodes.get(nid)).filter(Boolean);
}
// ✅ UPDATE moveUnit function in board.js
function moveUnit(unitId, fromId, toId) {
    const fromNode = getNode(fromId);
    const toNode = getNode(toId);
    if (!fromNode || !toNode) {
        console.log("from and to units don't exist");
        return false;
    }
    if (!fromNode.neighbors.includes(toId)) {
        console.log("Not a neighbor");
        return false;
    }

    fromNode.removeOccupant(unitId);
    toNode.addOccupant(unitId);

    const unit = units.get(unitId);
    if (unit) {
        unit.position = toId;

        // ✅ LOG GK MOVEMENT AND PENALTY
        if (unit.isGK) {
            let penalty = 0;
            if (unit.ownerId === 'P1') {
                if (toId === 1) penalty = 0;
                else if (toId === 2 || toId === 3) penalty = 3;
                else penalty = 6;
            } else if (unit.ownerId === 'P2') {
                if (toId === 12) penalty = 0;
                else if (toId === 10 || toId === 11) penalty = 3;
                else penalty = 6;
            }

            console.log(`🥅 GK ${unit.name} moved to node ${toId} → Speed Penalty: -${penalty}`);
        }
    }

    assertNoDuplicateOccupants();
    return true;
}
function dumpBoard() {
    for (let [id, node] of nodes.entries()) {
        console.log(`Node ${id}${node.isGK ? " (GK)" : ""}: [${[...node.occupants].join(", ")}]`);
    }
}
function assertNoDuplicateOccupants() {
    const seen = new Set();
    for (let [id, node] of nodes.entries()) {
        for (const occ of node.occupants) {
            if (seen.has(occ)) {
                throw new Error(`Unit ${occ} found in multiple nodes!`);
            }
            seen.add(occ);
        }
    }
}
// Add this function to clear all node occupants
function resetNodes() {
    for (const node of nodes.values()) {
        node.occupants.clear();
    }
}
export { Node, nodes, getNode, getNeighbors, moveUnit, dumpBoard, assertNoDuplicateOccupants, resetNodes };