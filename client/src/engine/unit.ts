import { getNode, assertNoDuplicateOccupants, nodes } from "./board";
import cards from "./cards.json";
import { renderStamina } from '/home/sae/tcg-engine/src/main'


class Unit {
    id: string;
    name : string;
    rarity : string;
    ownerId: string;
    cardId: string;
    position: number;
    stamina: number;
    lockTurns: number;
    hasBall: boolean;
    canMoveAfterBattle?: boolean;
    stats: any;


    constructor(id: string, ownerId: string, cardId: string, position: number, stamina: number) {
        this.id = id;
        this.ownerId = ownerId;
        this.cardId = cardId;
        this.position = position;
        this.stamina = stamina;
        this.lockTurns = 0;
        this.hasBall = false;
        this.rarity = cardMap.get(cardId)?.rarity;
        this.name = cardMap.get(cardId)?.name;

    }

    spendStamina(cost: number): boolean {
        if (this.stamina >= cost) {
            this.stamina -= cost;
            renderStamina();
            return true; // enough stamina
        } else {
            this.stamina = 0; // exhausted
            return false; // not enough stamina (–3 penalty applies)
        }
    }


}
const cardMap = new Map(cards.map((c: any) => [c.cardId, c]));
const units: Map<string, Unit> = new Map();
let unitCounter = 1;


function spawnUnitFromCard(ownerId: string, cardId: string, startNode: number): string {
    const template = cardMap.get(cardId);
    if (!template) throw new Error(`Card template not found: ${cardId}`);

    const stamina = template.stamina;
    const hasBall = !!template.hasBall; // Ensure boolean
    const unitId = `${ownerId}-${cardId}-${hasBall}-${unitCounter++}`;
    const unit = new Unit(unitId, ownerId, cardId, startNode, stamina);
    unit.hasBall = hasBall;

    units.set(unitId, unit);
    nodes.get(startNode)?.addOccupant(unitId);

    return unitId;

}

// Add this function to clear units and reset the counter
function resetUnits() {
    units.clear();
    unitCounter = 1;
}
export { Unit, units, spawnUnitFromCard, cardMap, resetUnits };


