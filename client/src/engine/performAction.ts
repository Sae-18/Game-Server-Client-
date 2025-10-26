import { units } from "./unit";
import { getNode } from "./board";

function performAction(
  unitId: string,
  action: "dribble" | "pass" | "shoot",
  target: number | string,
  tm: any
) {
  const unit = units.get(unitId);
  if (!unit) return { result: "illegal", reason: "unit not found" };
  if (unit.ownerId !== tm.currentPlayer) return { result: "illegal", reason: "not your turn" };
  if (!unit.hasBall && action !== "dribble") {
    return { result: "illegal", reason: "unit does not have the ball" };
  }

  switch (action) {
    // ----- DRIBBLE -----
    case "dribble": {
      const destNode = getNode(target as number);
      if (!destNode) {
        console.error(`[DRIBBLE ERROR] Target node ${target} not found for unit ${unitId}`);
        return { result: "illegal", reason: "target node not found" };
      }

      const fromNode = getNode(unit.position);

      // If empty → move freely
      if (destNode.isEmpty()) {
        fromNode?.removeOccupant(unitId);
        destNode.addOccupant(unitId);
        unit.position = target as number;
        return { result: "moved", unit: unitId, to: target as number };
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
      console.error(
        `[DRIBBLE ERROR] Unit ${unitId} tried to dribble into node ${destNode.id}, but teammate is already there.`
      );
      return { result: "illegal", reason: "teammate in target node" };

      // --- SAFEGUARD (should never happen) ---
      console.error(
        `[DRIBBLE ERROR] Unit ${unitId} attempted dribble into node ${target}, but no valid movement happened.`
      );
      return { result: "illegal", reason: "dribble failed unexpectedly" };
    }


    // ----- PASS -----
    case "pass": {
      const destNode = getNode(target as number);
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
      const goalNode = getNode(target as number);
      if (!goalNode) return { result: "illegal", reason: "target node not found" };
      if (!goalNode.isGK) return { result: "illegal", reason: "not a goal node" };

      // Must be adjacent or in range — tweak as needed
      if (unit.position !== goalNode.id) {
        return { result: "illegal", reason: "not in shooting range" };
      }

      // Enemy GK present → battle pending
      for (const occ of goalNode.occupants) {
        const other = units.get(occ);
        if (other && other.ownerId !== unit.ownerId) {
          return {
            result: "battle pending",
            attacker: unitId,
            defender: other.id,
            nodeId: goalNode.id,
          };
        }
      }

      // No GK → automatic goal
      return { result: "goal", scorer: unitId };
    }
  }
}

export { performAction };
