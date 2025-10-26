import { units } from "./unit";
import { getNode } from "./board";

function performAction(unitId, action, target, tm) {
    const unit = units.get(unitId);
    if (!unit) return { result: "illegal", reason: "unit not found" };
    if (unit.ownerId !== tm.currentPlayer) return { result: "illegal", reason: "not your turn" };
    if (!unit.hasBall && action !== "dribble") {
        return { result: "illegal", reason: "unit does not have the ball" };
    }

    switch (action) {
        // ----- DRIBBLE -----
        case "dribble": {
            const destNode = getNode(target);
            if (!destNode) {
                console.error(`[DRIBBLE ERROR] Target node ${target} not found for unit ${unitId}`);
                return { result: "illegal", reason: "target node not found" };
            }

            const fromNode = getNode(unit.position);

            // If empty → move freely
            if (destNode.isEmpty()) {
                fromNode?.removeOccupant(unitId);
                destNode.addOccupant(unitId);
                unit.position = target;
                return { result: "moved", unit: unitId, to: target };
            }

            // Occupied by enemy → battle pending
            for (const occ of destNode.occupants) {
                const other = units.get(occ);
                if (other && other.ownerId !== unit.ownerId) {
                    return {
                        result: "battle pending",
                        attacker: unitId,
                        defender: other.id,
                        nodeId: destNode.id,
                    };
                }
            }

            // Occupied by teammate → illegal
            console.error(`[DRIBBLE ERROR] Unit ${unitId} tried to dribble into node ${destNode.id}, but teammate is already there.`);
            return { result: "illegal", reason: "teammate in target node" };
        }

        // ----- PASS -----
        case "pass": {
            const destNode = getNode(target);
            if (!destNode) return { result: "illegal", reason: "target node not found" };

            // Enemy present → battle pending
            for (const occ of destNode.occupants) {
                const other = units.get(occ);
                if (other && other.ownerId !== unit.ownerId) {
                    return {
                        result: "battle pending",
                        attacker: unitId,
                        defender: other.id,
                        nodeId: destNode.id,
                    };
                }
            }

            // Friendly unit present → pass succeeds
            for (const occ of destNode.occupants) {
                const teammate = units.get(occ);
                if (teammate && teammate.ownerId === unit.ownerId) {
                    unit.hasBall = false;
                    teammate.hasBall = true;
                    return { result: "pass", from: unitId, to: teammate.id };
                }
            }

            return { result: "illegal", reason: "no teammate to pass to" };
        }

        // ----- SHOOT -----
        case "shoot": {
            // Can only shoot from goalkeeper nodes (1 or 12)
            const currentPosition = unit.position;

            // Determine which goal we're shooting at
            let goalNode;
            if (unit.ownerId === 'P1') {
                // P1 shoots at node 12
                if (currentPosition !== 12) {
                    return { result: "illegal", reason: "not at opponent's goal" };
                }
                goalNode = 12;
            } else {
                // P2 shoots at node 1
                if (currentPosition !== 1) {
                    return { result: "illegal", reason: "not at opponent's goal" };
                }
                goalNode = 1;
            }

            const gkNode = getNode(goalNode);
            if (!gkNode) return { result: "illegal", reason: "goal node not found" };

            // Check if there's a goalkeeper
            for (const occ of gkNode.occupants) {
                const other = units.get(occ);
                if (other && other.ownerId !== unit.ownerId) {
                    // Enemy GK present → battle
                    return {
                        result: "battle pending",
                        attacker: unitId,
                        defender: other.id,
                        nodeId: gkNode.id,
                    };
                }
            }

            // No GK → automatic goal
            return { result: "goal", scorer: unitId };
        }

        default:
            return { result: "illegal", reason: "unknown action" };
    }
}

export { performAction };