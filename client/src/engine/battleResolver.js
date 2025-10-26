import { units, cardMap } from "./unit";
import { getNode } from "./board";

function getRandInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolve1v1(attackerId, defenderId, action, turnManager, targetNodeId, manualRolls) {
  const attacker = units.get(attackerId);
  const defender = units.get(defenderId);
  if (!attacker || !defender) return null;

  const atkCard = cardMap.get(attacker.cardId);
  const defCard = cardMap.get(defender.cardId);
  if (!atkCard || !defCard) return null;

  let atkVal = 0, defVal = 0, atkCost = 0, defCost = 0;

  // Calculate battle values per rulebook
  if (action === "dribble") {
    atkVal = (atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0);
    defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0);
    atkCost = Math.max(atkCard.stats.dribbling?.cost || 0, atkCard.stats.speed?.cost || 0);
    defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);
  } else if (action === "pass") {
    atkVal = (atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0);
    defVal = (defCard.stats.speed?.value || 0) * 2;
    atkCost = Math.max(atkCard.stats.passing?.cost || 0, atkCard.stats.speed?.cost || 0);
    defCost = defCard.stats.speed?.cost || 0;
  } else if (action === "shoot") {
    atkVal = (atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0);
    defVal = (defCard.stats.defending?.value || 0) + (defCard.stats.speed?.value || 0);
    atkCost = Math.max(atkCard.stats.shooting?.cost || 0, atkCard.stats.speed?.cost || 0);
    defCost = Math.max(defCard.stats.defending?.cost || 0, defCard.stats.speed?.cost || 0);
  }

  const diff = atkVal - defVal;
  let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

  // Rulebook: diff > 5 = auto win
  if (Math.abs(diff) > 5) {
    winner = diff > 0 ? attackerId : defenderId;
    if (winner === defenderId) attacker.spendStamina(atkCost);
    else defender.spendStamina(defCost);
  } else {
    // Die roll battle
    dieRollUsed = true;
    attacker.spendStamina(atkCost);
    defender.spendStamina(defCost);

    if (manualRolls) {
      atkRoll = manualRolls.attacker;
      defRoll = manualRolls.defender;
    } else {
      atkRoll = getRandInt(1, 6);
      defRoll = getRandInt(1, 6);
    }

    // Weaker side gets -2 penalty
    let finalAtk = atkVal + atkRoll;
    let finalDef = defVal + defRoll;
    
    if (atkVal < defVal) finalAtk -= 2;
    else if (defVal < atkVal) finalDef -= 2;

    winner = finalAtk > finalDef ? attackerId : defenderId;
  }

  // Apply effects per rulebook
  const effects = {};
  if (dieRollUsed) {
    effects.attackerRoll = atkRoll;
    effects.defenderRoll = defRoll;
  }

  const loser = winner === attackerId ? defenderId : attackerId;
  const loserUnit = units.get(loser);

  // Locks: 2 turns for dribble, 1 for pass/shoot
  if (action === "dribble") {
    loserUnit.lockTurns = 2;
  } else {
    loserUnit.lockTurns = 1;
  }

  // Ball transfer
  if (winner === attackerId) {
    attacker.hasBall = true;
    defender.hasBall = false;
    
    if (action === "pass" && targetNodeId) {
      const targetNode = getNode(targetNodeId);
      if (targetNode) {
        for (const occId of targetNode.occupants) {
          const occ = units.get(occId);
          if (occ && occ.ownerId === attacker.ownerId) {
            attacker.hasBall = false;
            occ.hasBall = true;
            effects.ballRecipient = occId;
            break;
          }
        }
      }
    } else if (action === "shoot") {
      effects.scoreGoal = true;
    }
  } else {
    defender.hasBall = true;
    attacker.hasBall = false;
    
    if (action === "shoot") {
      const pos = attacker.position;
      effects.moveBackNode = pos === 12 ? 10 : (pos === 1 ? 2 : null);
    }
  }

  return { winner, loser, action, postEffects: effects };
}

function resolve2v1(attackerId, defenderIds, action, turnManager, targetNodeId) {
  const attacker = units.get(attackerId);
  const def1 = units.get(defenderIds[0]);
  const def2 = units.get(defenderIds[1]);
  if (!attacker || !def1 || !def2) return null;

  const atkCard = cardMap.get(attacker.cardId);
  const def1Card = cardMap.get(def1.cardId);
  const def2Card = cardMap.get(def2.cardId);
  if (!atkCard || !def1Card || !def2Card) return null;

  let atkVal = 0, defVal = 0;

  // Solo attacker gets 1.95x multiplier
  if (action === "dribble") {
    atkVal = ((atkCard.stats.dribbling?.value || 0) + (atkCard.stats.speed?.value || 0)) * 1.95;
    defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) +
             (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0);
  } else if (action === "pass") {
    atkVal = ((atkCard.stats.passing?.value || 0) + (atkCard.stats.speed?.value || 0)) * 1.95;
    defVal = (def1Card.stats.speed?.value || 0) + (def2Card.stats.speed?.value || 0);
  } else if (action === "shoot") {
    atkVal = ((atkCard.stats.shooting?.value || 0) + (atkCard.stats.speed?.value || 0)) * 1.95;
    defVal = (def1Card.stats.defending?.value || 0) + (def1Card.stats.speed?.value || 0) +
             (def2Card.stats.defending?.value || 0) + (def2Card.stats.speed?.value || 0);
  }

  const diff = atkVal - defVal;
  let winner, dieRollUsed = false, atkRoll = null, defRoll = null;

  // Threshold is 10 for 2v1
  if (Math.abs(diff) > 10) {
    winner = diff > 0 ? attackerId : 'defenders';
  } else {
    dieRollUsed = true;
    atkRoll = getRandInt(1, 6);
    defRoll = getRandInt(1, 6);

    let finalAtk = atkVal + atkRoll;
    let finalDef = defVal + defRoll;
    
    if (atkVal < defVal) finalAtk -= 2;
    else if (defVal < atkVal) finalDef -= 2;

    winner = finalAtk > finalDef ? attackerId : 'defenders';
  }

  const effects = { is2v1: true, defenderIds };
  if (dieRollUsed) {
    effects.attackerRoll = atkRoll;
    effects.defendersRoll = defRoll;
  }

  // Locks
  if (winner === attackerId) {
    def1.lockTurns = action === "dribble" ? 2 : 1;
    def2.lockTurns = action === "dribble" ? 2 : 1;
    attacker.hasBall = true;
    def1.hasBall = false;
    def2.hasBall = false;
    
    if (action === "pass" && targetNodeId) {
      const targetNode = getNode(targetNodeId);
      if (targetNode) {
        for (const occId of targetNode.occupants) {
          const occ = units.get(occId);
          if (occ && occ.ownerId === attacker.ownerId) {
            attacker.hasBall = false;
            occ.hasBall = true;
            effects.ballRecipient = occId;
            break;
          }
        }
      }
    } else if (action === "shoot") {
      effects.scoreGoal = true;
    }
  } else {
    attacker.lockTurns = action === "dribble" ? 2 : 1;
    attacker.hasBall = false;
    effects.chooseBallRecipient = true;
    
    if (action === "shoot") {
      const pos = attacker.position;
      effects.moveBackNode = pos === 12 ? 10 : (pos === 1 ? 2 : null);
    }
  }

  return { winner, losers: winner === attackerId ? defenderIds : [attackerId], action, postEffects: effects };
}

export { resolve1v1, resolve2v1 };