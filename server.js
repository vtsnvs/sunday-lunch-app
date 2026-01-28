require('dotenv').config();
const express = require('express');
const http = require('http'); // New
const { Server } = require("socket.io"); // New
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app); // Wrap express in HTTP server
const io = new Server(server); // Initialize Socket.io

const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Disable caching
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS food_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, votes INTEGER DEFAULT 0);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_status (id INTEGER PRIMARY KEY, order_closed BOOLEAN DEFAULT FALSE);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS allowed_users (name TEXT PRIMARY KEY);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS vote_logs (user_id TEXT PRIMARY KEY, voted_at TIMESTAMP DEFAULT NOW(), food_id INTEGER);`);
        await pool.query(`INSERT INTO admin_status (id, order_closed) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;`);
        console.log("Database initialized.");
    } catch (err) { console.error("DB Init Error:", err); }
};
initDb();

// --- SOCKET.IO CONNECTION ---
io.on('connection', (socket) => {
    console.log('A user connected');
});

// --- API ROUTES (Now with Real-time triggers) ---

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM allowed_users ORDER BY name ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users', async (req, res) => {
    try {
        await pool.query("INSERT INTO allowed_users (name) VALUES ($1) ON CONFLICT DO NOTHING", [req.body.name]);
        io.emit('data_update', { type: 'users' }); // Notify everyone
        res.json({ message: "User added" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/delete', async (req, res) => {
    try {
        await pool.query("DELETE FROM allowed_users WHERE name=$1", [req.body.name]);
        io.emit('data_update', { type: 'users' }); // Notify everyone
        res.json({ message: "User removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/food', async (req, res) => {
    try {
        // Keep list stable by sorting by ID
        const result = await pool.query("SELECT * FROM food_items ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vote-status/:user', async (req, res) => {
    try {
        const result = await pool.query("SELECT food_id FROM vote_logs WHERE user_id=$1", [req.params.user]);
        res.json({ food_id: result.rows.length > 0 ? result.rows[0].food_id : null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vote', async (req, res) => {
    const { food_id, user_id } = req.body;
    if (!user_id) return res.status(400).json({ message: "Who are you?" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const statusRes = await client.query("SELECT order_closed FROM admin_status WHERE id=1");
        if (statusRes.rows[0].order_closed) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "Voting is closed!" });
        }

        const userCheck = await client.query("SELECT name FROM allowed_users WHERE name = $1", [user_id]);
        if (userCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "You are not on the list!" });
        }

        const existingVote = await client.query("SELECT food_id FROM vote_logs WHERE user_id = $1", [user_id]);

        if (existingVote.rows.length > 0) {
            const oldFoodId = existingVote.rows[0].food_id;
            if (oldFoodId !== food_id) {
                if (oldFoodId) await client.query("UPDATE food_items SET votes = votes - 1 WHERE id=$1", [oldFoodId]);
                await client.query("UPDATE food_items SET votes = votes + 1 WHERE id=$1", [food_id]);
                await client.query("UPDATE vote_logs SET food_id=$1, voted_at=NOW() WHERE user_id=$2", [food_id, user_id]);
            }
        } else {
            await client.query("UPDATE food_items SET votes = votes + 1 WHERE id=$1", [food_id]);
            await client.query("INSERT INTO vote_logs (user_id, food_id) VALUES ($1, $2)", [user_id, food_id]);
        }

        await client.query('COMMIT');
        
        io.emit('data_update', { type: 'votes' }); // Real-time trigger
        res.json({ message: "Vote counted!" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/admin/add', async (req, res) => {
    try {
        const result = await pool.query("INSERT INTO food_items (name) VALUES ($1) RETURNING id", [req.body.name]);
        io.emit('data_update', { type: 'menu' }); // Notify everyone
        res.json({ message: "Food added", id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/remove', async (req, res) => {
    try {
        await pool.query("DELETE FROM food_items WHERE id=$1", [req.body.id]);
        io.emit('data_update', { type: 'menu' }); // Notify everyone
        res.json({ message: "Food removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/close', async (req, res) => {
    try {
        await pool.query("UPDATE admin_status SET order_closed=TRUE WHERE id=1");
        io.emit('status_change', { open: false });
        res.json({ message: "Voting closed!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reset-votes', async (req, res) => {
    try {
        await pool.query("UPDATE food_items SET votes=0");
        await pool.query("DELETE FROM vote_logs");
        await pool.query("UPDATE admin_status SET order_closed=FALSE WHERE id=1");
        io.emit('data_update', { type: 'reset' }); // Full reset trigger
        res.json({ message: "New week started!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reset-all', async (req, res) => {
    try {
        await pool.query("DELETE FROM food_items");
        await pool.query("DELETE FROM vote_logs");
        await pool.query("UPDATE admin_status SET order_closed=FALSE WHERE id=1");
        io.emit('data_update', { type: 'reset' });
        res.json({ message: "Everything reset!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/counts', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM food_items ORDER BY votes DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Automatic Reset
cron.schedule('1 0 * * 1', async () => {
    try {
        await pool.query("UPDATE food_items SET votes=0");
        await pool.query("DELETE FROM vote_logs");
        await pool.query("UPDATE admin_status SET order_closed=FALSE WHERE id=1");
        io.emit('data_update', { type: 'reset' });
    } catch (err) { console.error("Reset failed:", err); }
});

// Use server.listen instead of app.listen
server.listen(port, () => console.log(`Server running at http://localhost:${port}`));