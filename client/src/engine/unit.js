import { nodes } from "./board";
import cards from "./cards.json";
import { renderStaminaBars } from '../gameRooms.js';
class Unit {
    constructor(id, ownerId, cardId, position, stamina) {
        var _a, _b, _c;
        this.id = id;
        this.ownerId = ownerId;
        this.cardId = cardId;
        this.position = position;
        this.stamina = stamina;
        this.baseStamina = stamina;
        this.lockTurns = 0;
        this.hasBall = false;
        this.rarity = (_a = cardMap.get(cardId)) === null || _a === void 0 ? void 0 : _a.rarity;
        this.name = (_b = cardMap.get(cardId)) === null || _b === void 0 ? void 0 : _b.name;
        this.stats = (_c = cardMap.get(cardId)) === null || _c === void 0 ? void 0 : _c.stats;
    }
    spendStamina(cost) {
        if (this.stamina >= cost) {
            this.stamina -= cost;
            renderStaminaBars();
            return true; // enough stamina
        }
        else {
            this.stamina = 0; // exhausted
            return false; // not enough stamina (–3 penalty applies)
        }
    }
}
const cardMap = new Map(cards.map((c) => [c.cardId, c]));
const units = new Map();
let unitCounter = 1;
function spawnUnitFromCard(ownerId, cardId, startNode) {
    var _a;
    const template = cardMap.get(cardId);
    if (!template)
        throw new Error(`Card template not found: ${cardId}`);
    const stamina = template.stamina;
    const baseStamina = template.stamina;
    const stats = template.stats;
    const hasBall = !!template.hasBall;

    // ✅ Use deterministic ID based on owner, card, and position instead of counter
    const unitId = `${ownerId}-${cardId}-${startNode}`;

    // ✅ If unit already exists at this position, remove it first
    const existingUnit = units.get(unitId);
    if (existingUnit) {
        const node = nodes.get(startNode);
        if (node) {
            node.removeOccupant(unitId);
        }
        units.delete(unitId);
    }

    const unit = new Unit(unitId, ownerId, cardId, startNode, stamina);
    unit.hasBall = hasBall;
    units.set(unitId, unit);
    (_a = nodes.get(startNode)) === null || _a === void 0 ? void 0 : _a.addOccupant(unitId);
    return unitId;
}

// Add this function to clear units and reset the counter
function resetUnits() {
    // ✅ Clear all node occupants first
    for (let i = 1; i <= 12; i++) {
        const node = nodes.get(i);
        if (node) {
            node.occupants.clear();
        }
    }

    units.clear();
    // ✅ No need to reset unitCounter since we use deterministic IDs now
}
export { Unit, units, spawnUnitFromCard, cardMap, resetUnits };