import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { ImplantData } from '../constants/implants';
import { collection, getDocs } from 'firebase/firestore';

export const useImplantsData = () => {
    const [implants, setImplants] = useState<ImplantData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchImplants = async () => {
            try {
                const snapshot = await getDocs(collection(db, 'implants'));
                const implantsData = snapshot.docs.map((doc) => ({
                    ...doc.data(),
                    id: doc.id,
                })) as ImplantData[];
                setImplants(implantsData);
                setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch implants');
                setLoading(false);
            }
        };

        fetchImplants();
    }, []);

    return { implants, loading, error };
};
