import { db } from '../../config/firebase';
import { collection, getDocs, doc, getDoc, query, where, limit } from 'firebase/firestore';
import { BaseStats } from '../../types/stats';
import { RarityName } from '../../constants/rarities';
import { FactionName } from '../../constants/factions';
import { ShipTypeName } from '../../constants/shipTypes';
import { AffinityName, Ship } from '../../types/ship';

const SHIPS_COLLECTION = 'ships';
const CACHE_DURATION = 1000 * 60 * 24; // 24 hours

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// Interface matching Firebase data structure
interface FirebaseShip {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    critRate: number;
    critDamage: number;
    speed: number;
    affinity: string;
    imageKey: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
}

class ShipsService {
    private cache: Map<string, CacheEntry<Ship[] | Ship>> = new Map();

    private isValidCache(entry: CacheEntry<Ship[] | Ship>): boolean {
        return Date.now() - entry.timestamp < CACHE_DURATION;
    }

    // Helper method to format ship name into a consistent ID format
    private formatShipId(name: string): string {
        return name.toUpperCase().replace(/\s+/g, '_');
    }

    async getAllShips(): Promise<Ship[]> {
        const cacheKey = 'all_ships_array';
        const cachedData = this.cache.get(cacheKey);

        if (cachedData && this.isValidCache(cachedData)) {
            return cachedData.data as Ship[];
        }

        const shipsSnapshot = await getDocs(collection(db, SHIPS_COLLECTION));
        const firebaseShips = shipsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as FirebaseShip[];

        const transformedShips = this.transformShipsData(firebaseShips);

        this.cache.set(cacheKey, {
            data: transformedShips,
            timestamp: Date.now(),
        });

        return transformedShips;
    }

    async getShipById(id: string): Promise<Ship | null> {
        const cacheKey = `ship_${id}`;
        const cachedData = this.cache.get(cacheKey);

        if (cachedData && this.isValidCache(cachedData)) {
            return cachedData.data as Ship;
        }

        const shipDoc = await getDoc(doc(db, SHIPS_COLLECTION, id));

        if (!shipDoc.exists()) {
            return null;
        }

        const firebaseShip = {
            id: shipDoc.id,
            ...shipDoc.data(),
        } as FirebaseShip;

        const transformedShip = this.transformShipsData([firebaseShip])[0];

        this.cache.set(cacheKey, {
            data: transformedShip,
            timestamp: Date.now(),
        });

        return transformedShip;
    }

    async getShipByName(name: string): Promise<Ship | null> {
        const cacheKey = `ship_name_${name.toLowerCase()}`;
        const cachedData = this.cache.get(cacheKey);

        if (cachedData && this.isValidCache(cachedData)) {
            return cachedData.data as Ship;
        }

        // First try to get the ship by ID (uppercase version of name)
        const shipId = this.formatShipId(name);
        const shipById = await this.getShipById(shipId);

        if (shipById) {
            this.cache.set(cacheKey, {
                data: shipById,
                timestamp: Date.now(),
            });
            return shipById;
        }

        // If not found by ID, create a query against the collection to find the ship by name
        const q = query(collection(db, SHIPS_COLLECTION), where('name', '==', name), limit(1));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            // Try a case-insensitive search as a fallback by getting all ships
            const allShips = await this.getAllShips();
            const shipMatch = allShips.find(
                (ship) => ship.name.toLowerCase() === name.toLowerCase()
            );

            if (!shipMatch) {
                return null;
            }

            this.cache.set(cacheKey, {
                data: shipMatch,
                timestamp: Date.now(),
            });

            return shipMatch;
        }

        const firebaseShip = {
            id: querySnapshot.docs[0].id,
            ...querySnapshot.docs[0].data(),
        } as FirebaseShip;

        const transformedShip = this.transformShipsData([firebaseShip])[0];

        this.cache.set(cacheKey, {
            data: transformedShip,
            timestamp: Date.now(),
        });

        return transformedShip;
    }

    clearCache() {
        this.cache.clear();
    }

    private transformShipsData(firebaseShips: FirebaseShip[]): Ship[] {
        return firebaseShips.map((ship) => ({
            id: ship.id,
            name: ship.name,
            rarity: ship.rarity.toLowerCase() as RarityName,
            faction: ship.faction as FactionName,
            type: ship.role as ShipTypeName,
            baseStats: {
                hp: ship.hp,
                attack: ship.attack,
                defence: ship.defense,
                hacking: ship.hacking,
                security: ship.security,
                crit: ship.critRate,
                critDamage: ship.critDamage,
                speed: ship.speed,
                healModifier: 0,
            } as BaseStats,
            equipment: {},
            refits: [],
            implants: [],
            affinity: ship.affinity.toLowerCase() as AffinityName,
            imageKey: ship.imageKey,
            activeSkillText: ship.activeSkillText,
            chargeSkillText: ship.chargeSkillText,
            firstPassiveSkillText: ship.firstPassiveSkillText,
            secondPassiveSkillText: ship.secondPassiveSkillText,
        }));
    }
}

export const shipsService = new ShipsService();
