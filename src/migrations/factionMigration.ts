const STORAGE_KEYS = ['ships']; // Add any other relevant storage keys

export const migrateTianshaoToTianchao = () => {
  STORAGE_KEYS.forEach((key) => {
    const stored = localStorage.getItem(key);
    if (!stored) return;

    try {
      const data = JSON.parse(stored);
      let hasChanges = false;

      // Handle arrays
      if (Array.isArray(data)) {
        data.forEach((item) => {
          if (item.faction === 'TIANSHAO') {
            item.faction = 'TIANCHAO';
            hasChanges = true;
          }
        });
      }
      // Handle direct faction references
      else if (data.faction === 'TIANSHAO') {
        data.faction = 'TIANCHAO';
        hasChanges = true;
      }

      if (hasChanges) {
        localStorage.setItem(key, JSON.stringify(data));
      }
    } catch (error) {
      console.error(`Error migrating faction data for ${key}:`, error);
    }
  });
};
