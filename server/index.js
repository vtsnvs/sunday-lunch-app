// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    "http://localhost:5173", 
    "http://localhost:3000",
    process.env.CLIENT_URL // This will be your Render Frontend URL
];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true
    }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-change-this';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const upload = multer({ storage: multer.memoryStorage() });

app.use(helmet());
app.use(cookieParser());
app.use(express.json());
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            // Allow if the origin matches the CLIENT_URL variable exactly
            if (origin === process.env.CLIENT_URL) return callback(null, true);
            return callback(new Error('CORS Not Allowed'), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

// --- MIDDLEWARE ---
const authenticate = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid Token" });
        req.user = user;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    authenticate(req, res, () => {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Admin access required" });
        next();
    });
};

const requireSuperAdmin = (req, res, next) => {
    requireAdmin(req, res, () => {
        if (req.user.username !== 'admin') return res.status(403).json({ message: "Only Superadmin can perform this action" });
        next();
    });
};

// --- DB INIT ---
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                password_changed BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS food_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, votes INTEGER DEFAULT 0, image_url TEXT);
            CREATE TABLE IF NOT EXISTS vote_logs (user_id INTEGER REFERENCES users(id), voted_at TIMESTAMP DEFAULT NOW(), food_id INTEGER);
            CREATE TABLE IF NOT EXISTS admin_status (id INTEGER PRIMARY KEY, order_closed BOOLEAN DEFAULT FALSE);
            
            INSERT INTO admin_status (id, order_closed) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;
        `);

        // SCHEMA UPDATE: Favorites & JSON Options
        await pool.query(`
            ALTER TABLE food_items ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]';
            ALTER TABLE food_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
            ALTER TABLE vote_logs ADD COLUMN IF NOT EXISTS selections JSONB DEFAULT '[]';
            ALTER TABLE vote_logs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
            
            CREATE TABLE IF NOT EXISTS favorites (
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                food_id INTEGER REFERENCES food_items(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, food_id)
            );
        `);

        // Root Admin
        const hash = await bcrypt.hash('admin', 10);
        await pool.query(`
            INSERT INTO users (username, password_hash, role, password_changed) 
            VALUES ('admin', $1, 'admin', FALSE)
            ON CONFLICT (username) DO NOTHING
        `, [hash]);
        
        console.log("--> Database Initialized");

    } catch (err) { console.error("DB Init Error:", err); }
};
initDb();

// --- ROUTES ---

app.get('/api/users/list', async (req, res) => {
    try {
        const result = await pool.query("SELECT username, role FROM users WHERE username != 'admin' ORDER BY username ASC");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/status/:username', async (req, res) => {
    try {
        const result = await pool.query("SELECT password_changed FROM users WHERE username = $1", [req.params.username]);
        if (result.rows.length === 0) return res.json({ isDefault: false });
        res.json({ isDefault: !result.rows[0].password_changed });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.status(401).json({ message: "User not found" });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ message: "Invalid password" });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.json({ user: { id: user.id, username: user.username, role: user.role } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
    const { newPassword } = req.body;
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash=$1, password_changed=TRUE WHERE id=$2", [hash, req.user.id]);
    res.json({ message: "Updated" });
});

app.get('/api/me', authenticate, (req, res) => res.json({ user: req.user }));
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ message: "Logged out" }); });

// --- FAVORITES ---
app.get('/api/favorites', authenticate, async (req, res) => {
    const result = await pool.query("SELECT food_id FROM favorites WHERE user_id=$1", [req.user.id]);
    res.json(result.rows.map(r => r.food_id));
});

app.post('/api/favorites', authenticate, async (req, res) => {
    const { food_id } = req.body;
    const user_id = req.user.id;
    try {
        const check = await pool.query("SELECT * FROM favorites WHERE user_id=$1 AND food_id=$2", [user_id, food_id]);
        if(check.rows.length > 0) {
            await pool.query("DELETE FROM favorites WHERE user_id=$1 AND food_id=$2", [user_id, food_id]);
            res.json({ added: false });
        } else {
            await pool.query("INSERT INTO favorites (user_id, food_id) VALUES ($1, $2)", [user_id, food_id]);
            res.json({ added: true });
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- VOTING & DATA ---

app.get('/api/food', authenticate, async (req, res) => {
    let query = "SELECT * FROM food_items WHERE is_active = TRUE ORDER BY id ASC";
    if (req.user.role === 'admin') query = "SELECT * FROM food_items ORDER BY id ASC";

    const result = await pool.query(query);
    const myVote = await pool.query("SELECT food_id, selections, notes FROM vote_logs WHERE user_id=$1", [req.user.id]);
    
    res.json({ items: result.rows, voteData: myVote.rows[0] || null });
});

app.get('/api/status', authenticate, async (req, res) => {
    const result = await pool.query("SELECT order_closed FROM admin_status WHERE id=1");
    res.json({ closed: result.rows[0].order_closed });
});

app.post('/api/vote', authenticate, async (req, res) => {
    const { food_id, selections, notes } = req.body;
    const user_id = req.user.id;
    try {
        const status = await pool.query("SELECT order_closed FROM admin_status WHERE id=1");
        if (status.rows[0].order_closed) return res.status(403).json({ message: "Voting Closed" });
        
        const existing = await pool.query("SELECT food_id FROM vote_logs WHERE user_id=$1", [user_id]);
        if (existing.rows.length > 0) {
            const oldFood = existing.rows[0].food_id;
            if (oldFood !== food_id) {
                await pool.query("UPDATE food_items SET votes = votes - 1 WHERE id=$1", [oldFood]);
                await pool.query("UPDATE food_items SET votes = votes + 1 WHERE id=$1", [food_id]);
            }
            await pool.query(
                "UPDATE vote_logs SET food_id=$1, selections=$2, notes=$3 WHERE user_id=$4", 
                [food_id, JSON.stringify(selections || []), notes || '', user_id]
            );
        } else {
            await pool.query("UPDATE food_items SET votes = votes + 1 WHERE id=$1", [food_id]);
            await pool.query(
                "INSERT INTO vote_logs (user_id, food_id, selections, notes) VALUES ($1, $2, $3, $4)", 
                [user_id, food_id, JSON.stringify(selections || []), notes || '']
            );
        }
        io.emit('update', { type: 'votes' });
        res.json({ message: "Voted" });
    } catch (e) { res.status(500).json({error: e.message}); }
});

// --- ADMIN ---

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.username, COALESCE(f.name, 'Unknown Item') as food_name, v.selections, v.notes 
            FROM vote_logs v 
            JOIN users u ON v.user_id = u.id 
            LEFT JOIN food_items f ON v.food_id = f.id 
            ORDER BY u.username ASC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/food', requireAdmin, upload.single('image'), async (req, res) => {
    let imageUrl = null;
    if (req.file) {
        const streamUpload = (buffer) => new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream((error, result) => {
                if (result) resolve(result); else reject(error);
            });
            stream.end(buffer);
        });
        const result = await streamUpload(req.file.buffer);
        imageUrl = result.secure_url;
    }
    const options = req.body.options ? req.body.options : '[]';
    await pool.query("INSERT INTO food_items (name, image_url, options, is_active) VALUES ($1, $2, $3, TRUE)", 
        [req.body.name, imageUrl, options]);
    io.emit('update', { type: 'menu' });
    res.json({ message: "Food Added" });
});

app.put('/api/admin/food/:id', requireAdmin, upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { name, options } = req.body;
    let imageUrl = null;

    try {
        if (req.file) {
            const streamUpload = (buffer) => new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream((error, result) => {
                    if (result) resolve(result); else reject(error);
                });
                stream.end(buffer);
            });
            const result = await streamUpload(req.file.buffer);
            imageUrl = result.secure_url;
            
            await pool.query("UPDATE food_items SET name=$1, options=$2, image_url=$3 WHERE id=$4", 
                [name, options || '[]', imageUrl, id]);
        } else {
            await pool.query("UPDATE food_items SET name=$1, options=$2 WHERE id=$3", 
                [name, options || '[]', id]);
        }
        
        io.emit('update', { type: 'menu' });
        res.json({ message: "Food Updated" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/food/toggle', requireAdmin, async (req, res) => {
    const { id, is_active } = req.body;
    await pool.query("UPDATE food_items SET is_active=$1 WHERE id=$2", [is_active, id]);
    io.emit('update', { type: 'menu' });
    res.json({ message: "Updated" });
});

app.post('/api/admin/remove', requireAdmin, async (req, res) => {
    await pool.query("DELETE FROM food_items WHERE id=$1", [req.body.id]);
    io.emit('update', { type: 'menu' });
    res.json({ message: "Removed" });
});

app.post('/api/admin/toggle', requireAdmin, async (req, res) => {
    const { closed } = req.body; 
    await pool.query("UPDATE admin_status SET order_closed=$1 WHERE id=1", [closed]);
    io.emit('status_change', { closed });
    res.json({ message: "Status Updated" });
});

app.post('/api/admin/reset', requireAdmin, async (req, res) => {
    await pool.query("UPDATE food_items SET votes=0");
    await pool.query("DELETE FROM vote_logs");
    await pool.query("UPDATE admin_status SET order_closed=FALSE WHERE id=1");
    io.emit('update', { type: 'reset' });
    res.json({ message: "Reset" });
});

app.post('/api/admin/nuke', requireSuperAdmin, async (req, res) => {
    await pool.query("DELETE FROM food_items");
    await pool.query("DELETE FROM vote_logs");
    await pool.query("UPDATE admin_status SET order_closed=FALSE WHERE id=1");
    io.emit('update', { type: 'reset' });
    res.json({ message: "System Nuked" });
});

app.post('/api/admin/users', requireSuperAdmin, async (req, res) => {
    const { username, role } = req.body;
    const hash = await bcrypt.hash('admin', 10);
    try {
        await pool.query("INSERT INTO users (username, password_hash, role, password_changed) VALUES ($1, $2, $3, FALSE)", [username, hash, role || 'user']);
        io.emit('update', { type: 'users' }); 
        res.json({ message: "User Created" });
    } catch (e) { res.status(500).json({ message: "Username exists" }); }
});

app.post('/api/admin/delete-user', requireSuperAdmin, async (req, res) => {
    const { username } = req.body;
    if(username === 'admin') return res.status(403).json({message: "Cannot delete root admin"});
    try {
        const u = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
        if(u.rows.length > 0) {
            await pool.query("DELETE FROM vote_logs WHERE user_id=$1", [u.rows[0].id]);
            await pool.query("DELETE FROM users WHERE id=$1", [u.rows[0].id]);
            io.emit('update', { type: 'users' });
            res.json({message: "User Deleted"});
        } else { res.status(404).json({message: "Not found"}); }
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/admin/role', requireSuperAdmin, async (req, res) => {
    const { username, role } = req.body;
    if(username === 'admin') return res.status(403).json({message: "Cannot modify root admin"});
    await pool.query("UPDATE users SET role=$1 WHERE username=$2", [role, username]);
    io.emit('update', { type: 'users' });
    res.json({message: `User is now ${role}`});
});

const PORT = process.env.PORT || 3000; // Must use process.env.PORT!
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));