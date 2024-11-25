const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const INVENTORY_FILE = path.join(__dirname, 'data', 'inventory.json');

// Ensure data directory exists
const ensureDataDirectory = async () => {
    const dataDir = path.join(__dirname, 'data');
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir);
    }
};

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/inventory', async (req, res) => {
    try {
        const data = await fs.readFile(INVENTORY_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            // If file doesn't exist, return empty inventory
            res.json([]);
        } else {
            console.error('Error loading inventory:', error);
            res.status(500).json({ error: 'Failed to load inventory' });
        }
    }
});

app.post('/api/inventory', async (req, res) => {
    try {
        await ensureDataDirectory();
        await fs.writeFile(INVENTORY_FILE, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving inventory:', error);
        res.status(500).json({ error: 'Failed to save inventory' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, async () => {
    await ensureDataDirectory();
    console.log(`Server running on port ${PORT}`);
}); 