import { TurnManager } from "./turnManager";
import { units, cardMap } from "./unit";
import { getNode } from "./board";

export interface BattleResult {
  winner: string;
  loser: string;
  ballOwnerId: string;
  reason: string;
  action: 'dribble' | 'pass' | 'shoot';
  postEffects?: {
    moveForwardNode?: number;    // for dribble/shoot
    lockTurns?: number;          // for loser
    scoreGoal?: boolean;         // for shoot
    goalkeeperMove?: number[];   // possible GK pass targets
    dieRoll?: number;            // for upset rolls
    legalPassTargets?: number[]; // for passing
  };
}

function resolve1v1(
  attackerId: string,
  defenderId: string,
  action: "dribble" | "pass" | "shoot",
  turnManager: TurnManager,
  targetTeammateId?: string
): BattleResult | false {
  const attacker = units.get(attackerId);
  const defender = units.get(defenderId);
  if (!attacker || !defender) return false;

  const attackerCard = cardMap.get(attacker.cardId);
  const defenderCard = cardMap.get(defender.cardId);
  if (!attackerCard || !defenderCard) return false;

  // --- Determine attack and defense values ---
  let attackValue = 0;
  let defenceValue = 0;
  let atkCost = 0;
  let defCost = 0;

  switch (action) {
    case "dribble":
      atkCost = Math.max(attackerCard.stats.dribbling.cost, attackerCard.stats.speed.cost);
      defCost = Math.max(defenderCard.stats.defending.cost, defenderCard.stats.speed.cost);
      attackValue = attackerCard.stats.dribbling.value;
      defenceValue = defenderCard.stats.defending.value;
      break;

    case "pass":
      atkCost = Math.max(attackerCard.stats.passing.cost, attackerCard.stats.speed.cost);
      defCost = Math.max(defenderCard.stats.defending.cost, defenderCard.stats.speed.cost);
      attackValue = attackerCard.stats.passing.value;
      defenceValue = defenderCard.stats.defending.value;
      break;

    case "shoot":
      atkCost = Math.max(attackerCard.stats.shooting.cost, attackerCard.stats.speed.cost);
      defCost = Math.max(defenderCard.stats.defending.cost, defenderCard.stats.speed.cost);
      attackValue = attackerCard.stats.shooting.value;
      defenceValue = defenderCard.stats.defending.value;
      break;
  }

  // Deduct stamina for attacker & defender, note winner/loser logic comes after
  const attackerHadEnough = attacker.spendStamina(atkCost);
  const defenderHadEnough = defender.spendStamina(defCost);

  // --- Determine winner ---
  let winner: string;
  let loser: string;
  let reason = "";

  const diff = attackValue - defenceValue;
  let usedUpset = false;
  let upsetRollValue: number | undefined;

  if (Math.abs(diff) > 5) {
    if (diff > 0) {
      winner = attackerId;
      loser = defenderId;
      reason = "attacker higher stat";
    } else {
      winner = defenderId;
      loser = attackerId;
      reason = "defender higher stat";
    }
  } else {
    usedUpset = true;
    const upset = rollForUpset(defenceValue);
    upsetRollValue = upset.roll;
    if (upset.success) {
      winner = attackerId;
      loser = defenderId;
      reason = "upset roll success";
    } else {
      winner = defenderId;
      loser = attackerId;
      reason = "upset roll fail";
    }
  }

  // --- Apply post-effects ---
  const postEffects: BattleResult["postEffects"] = {};

  if (upsetRollValue !== undefined) {
    postEffects.dieRoll = upsetRollValue;
  }

  // Dribble: winner keeps ball, loser locked, winner may move
  if (action === "dribble") {
    if (winner === attackerId) {
      postEffects.lockTurns = 3; // defender (loser) locked for 3 turns
      attacker.hasBall = true;
      defender.hasBall = false;
      postEffects.moveForwardNode = undefined; // UI decides legal node
    } else {
      postEffects.lockTurns = 3; // attacker (loser) locked for 3 turns
      attacker.hasBall = false;
      defender.hasBall = true;
    }
  }

  // Pass: winner passes successfully
  if (action === "pass") {
    postEffects.lockTurns = 2; // Loser is locked for 2 turns
    if (winner === attackerId) {
      attacker.hasBall = false;
      if (targetTeammateId) {
        const teammate = units.get(targetTeammateId);
        if (teammate) teammate.hasBall = true;
      }
      postEffects.legalPassTargets = getLegalPassTargets(attackerId);
    } else {
      attacker.hasBall = false;
      defender.hasBall = true;
    }
  }

  // Shoot
  if (action === "shoot") {
    if (winner === attackerId) {
      postEffects.scoreGoal = true;
    } else {
      postEffects.lockTurns = 1;
      postEffects.moveForwardNode = attacker.position - 1; // move attacker one back
      defender.hasBall = true;
      // For UI: GK can pass 1-2 nodes ahead
      postEffects.goalkeeperMove = getGoalkeeperPassTargets(defenderId);
    }
  }

  // --- Apply extra stamina penalties if upset roll was used ---
  if (usedUpset) {
    // Both lose stamina for upset
    attacker.spendStamina(atkCost);
    defender.spendStamina(defCost);
  } else {
    // Only loser loses stamina
    const loserUnit = units.get(loser);
    const loserCard = cardMap.get(loserUnit!.cardId)!;
    let loserCost = 0;
    switch (action) {
      case "dribble":
        loserCost = Math.max(loserCard.stats.defending?.cost || 0, loserCard.stats.speed.cost);
        break;
      case "pass":
        loserCost = Math.max(loserCard.stats.defending?.cost || 0, loserCard.stats.speed.cost);
        break;
      case "shoot":
        loserCost = Math.max(loserCard.stats.defending?.cost || 0, loserCard.stats.speed.cost);
        break;
    }
    loserUnit!.spendStamina(loserCost);
  }

  return { winner, loser, reason, action, ballOwnerId: units.get(winner)!.id, postEffects };
}

function resolve2v1(
  attackerIds: string[],  // the 2 attackers
  defenderId: string,     // the single defender
  action: "dribble" | "pass" | "shoot",
  turnManager: TurnManager,
  targetTeammateId?: string
): BattleResult | false {
  const defender = units.get(defenderId);
  if (!defender) return false;

  const defenderCard = cardMap.get(defender.cardId);
  if (!defenderCard) return false;

  // Sum stats for the 2 attackers
  let totalAttack = 0;
  let atkCost = 0;
  attackerIds.forEach(aid => {
    const attacker = units.get(aid)!;
    const card = cardMap.get(attacker.cardId)!;
    atkCost += Math.max(card.stats[action]?.cost || 0, card.stats.speed.cost);
    totalAttack += (card.stats[action]?.value || 0) + (card.stats.speed.value || 0);
  });

  // Slight disadvantage multiplier
  totalAttack /= 1.95;

  const defenseValue = (defenderCard.stats.defending.value || 0) + (defenderCard.stats.speed.value || 0);
  const defCost = Math.max(defenderCard.stats.defending.cost, defenderCard.stats.speed.cost);

  // Deduct stamina first
  attackerIds.forEach(aid => units.get(aid)!.spendStamina(atkCost));
  defender.spendStamina(defCost);

  // Determine winner
  let winnerId: string;
  let loserIds: string[];
  let reason = "";

  if (totalAttack > defenseValue) {
    winnerId = attackerIds[0]; // the first attacker gets possession
    loserIds = [defenderId];
    reason = "attackers overpower defender";
  } else {
    winnerId = defenderId;
    loserIds = [...attackerIds];
    reason = "defender holds off attackers";
  }

  const postEffects: BattleResult["postEffects"] = {};

  // Post-effects logic, similar to 1v1
  if (action === "dribble") {
    if (winnerId === defenderId) {
      // attacker(s) locked
      attackerIds.forEach(aid => (units.get(aid)!.lockTurns = 1));
      attackerIds.forEach(aid => (units.get(aid)!.hasBall = false));
      defender.hasBall = true;
    } else {
      // defender locked, winner keeps ball
      defender.lockTurns = 2;
      defender.hasBall = false;
      winnerId = attackerIds[0];
      units.get(winnerId)!.hasBall = true;
      postEffects.moveForwardNode = undefined; // UI chooses node
    }
  }

  if (action === "pass") {
    if (winnerId !== defenderId && targetTeammateId) {
      const teammate = units.get(targetTeammateId);
      if (teammate) {
        teammate.hasBall = true;
        attackerIds.forEach(aid => units.get(aid)!.hasBall = false);
      }
    } else {
      attackerIds.forEach(aid => units.get(aid)!.lockTurns = 1);
      attackerIds.forEach(aid => units.get(aid)!.hasBall = false);
      defender.hasBall = true;
    }
    postEffects.legalPassTargets = []; // TODO: fill pass nodes
  }

  if (action === "shoot") {
    if (winnerId === defenderId) {
      attackerIds.forEach(aid => units.get(aid)!.lockTurns = 1);
      attackerIds.forEach(aid => units.get(aid)!.hasBall = false);
      defender.hasBall = true;
      postEffects.goalkeeperMove = []; // TODO: GK pass options
    } else {
      postEffects.scoreGoal = true;
    }
  }

  return {
    winner: winnerId,
    loser: loserIds.length === 1 ? loserIds[0] : loserIds.join(", "),
    ballOwnerId: winnerId,
    reason,
    action,
    postEffects
  };
}


function rollForUpset(opponentValue: number): { success: boolean, roll: number } {
  const roll = getRandInt(1, 6);
  const modifiedRoll = Math.max(0, roll - 2);
  return { success: modifiedRoll > opponentValue, roll };
}

function getRandInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// TODO: implement proper logic for legal pass nodes
function getLegalPassTargets(attackerId: string): number[] {
  return [];
}

// TODO: implement proper logic for GK pass options
function getGoalkeeperPassTargets(gkId: string): number[] {
  return [];
}

export { resolve1v1, resolve2v1 };
