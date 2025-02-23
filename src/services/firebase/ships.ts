import { db } from '../../config/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
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
}

class ShipsService {
    private cache: Map<string, CacheEntry<Ship[]>> = new Map();

    private isValidCache(entry: CacheEntry<Ship[]>): boolean {
        return Date.now() - entry.timestamp < CACHE_DURATION;
    }

    async getAllShips(): Promise<Ship[]> {
        const cacheKey = 'all_ships_array';
        const cachedData = this.cache.get(cacheKey);

        if (cachedData && this.isValidCache(cachedData)) {
            return cachedData.data;
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
            return cachedData.data;
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
        }));
    }
}

export const shipsService = new ShipsService();
