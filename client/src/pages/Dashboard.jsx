import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { AuthContext } from '../AuthContext';
import { useLocation } from 'react-router-dom';

const SOCKET_URL = import.meta.env.VITE_API_URL 
    ? import.meta.env.VITE_API_URL.replace('/api', '') 
    : "http://localhost:3000";

const socket = io(SOCKET_URL, { withCredentials: true });

export default function Dashboard() {
    const { user, logout } = useContext(AuthContext);
    const location = useLocation();
    
    // Determine initial view based on how they logged in
    const initialAdminState = location.state?.view === 'admin' && user.role === 'admin';
    const [viewAdmin, setViewAdmin] = useState(initialAdminState);

    const [food, setFood] = useState([]);
    const [status, setStatus] = useState(false); 
    const [userList, setUserList] = useState([]);

    // Inputs
    const [newFood, setNewFood] = useState("");
    const [newImage, setNewImage] = useState(null);
    const [newUser, setNewUser] = useState("");
    const [newPass, setNewPass] = useState(""); 
    const [showPassModal, setShowPassModal] = useState(false);

    useEffect(() => {
        fetchData();
        if(user.role === 'admin') fetchUsers();

        socket.on('update', (data) => {
            if (data.type === 'menu' || data.type === 'votes' || data.type === 'reset') fetchData();
            if (data.type === 'users' && user.role === 'admin') fetchUsers();
        });
        socket.on('status_change', (data) => setStatus(data.closed));
        
        return () => {
            socket.off('update');
            socket.off('status_change');
        };
    }, [user.role]);

    const fetchData = () => {
        axios.get('/food').then(res => setFood(res.data));
        axios.get('/status').then(res => setStatus(res.data.closed));
    };

    const fetchUsers = () => {
        // FIX: Removed extra '/api' prefix that was causing 404
        axios.get('/users/list').then(res => setUserList(res.data));
    };

    const handleVote = async (id) => {
        try {
            await axios.post('/vote', { food_id: id });
            alert("Voted!");
        } catch (e) { alert(e.response.data.message); }
    };

    const handleChangePassword = async () => {
        if (!newPass) return;
        try {
            await axios.post('/auth/change-password', { newPassword: newPass });
            alert("Password updated! Please remember it.");
            setShowPassModal(false);
            setNewPass("");
        } catch(e) { alert("Failed to update"); }
    };

    // --- ADMIN ACTIONS ---
    const handleAddFood = async () => {
        const formData = new FormData();
        formData.append('name', newFood);
        if (newImage) formData.append('image', newImage);
        await axios.post('/admin/food', formData);
        setNewFood(""); setNewImage(null);
    };

    const handleCreateUser = async () => {
        await axios.post('/admin/users', { username: newUser, role: 'user' });
        alert(`User ${newUser} created! Password is 'admin'`);
        setNewUser("");
    };

    const handleDeleteUser = async (username) => {
        if(confirm(`Delete ${username}?`)) await axios.post('/admin/delete-user', { username });
    };

    const handlePromote = async (username) => {
        if(confirm(`Make ${username} an Admin?`)) await axios.post('/admin/role', { username, role: 'admin' });
    };

    const handleDemote = async (username) => {
        if(confirm(`Remove Admin rights from ${username}?`)) await axios.post('/admin/role', { username, role: 'user' });
    };

    const handleReset = async () => {
        if(confirm("Reset everything for new week?")) await axios.post('/admin/reset');
    };

    const toggleVoting = async () => {
        await axios.post('/admin/toggle', { closed: !status });
    };

    return (
        <div className="container">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
                <h1>{user.role === 'admin' ? '👑 Chef\'s Table' : '🍽️ Sunday Lunch'}</h1>
                <div style={{display:'flex', gap:'10px'}}>
                    <button onClick={() => setShowPassModal(!showPassModal)} style={{background:'var(--secondary)', color:'white', fontSize:'0.8rem'}}>Change PW</button>
                    <button onClick={logout} style={{background:'#333', color:'white', fontSize:'0.8rem'}}>Logout</button>
                </div>
            </div>

            {/* Admin Toggle View Button */}
            {user.role === 'admin' && (
                <div style={{textAlign:'center', marginBottom:'20px'}}>
                    <button onClick={() => setViewAdmin(!viewAdmin)} style={{background: viewAdmin ? '#555' : 'var(--primary)', color:'white'}}>
                        {viewAdmin ? 'Go to Voting View' : 'Go to Admin Panel'}
                    </button>
                </div>
            )}

            {/* PASSWORD MODAL */}
            {showPassModal && (
                <div className="admin-controls" style={{marginTop:0, marginBottom:'2rem', border:'2px solid var(--primary)'}}>
                    <h3>Change My Password</h3>
                    <div className="input-group">
                        <input type="password" placeholder="New Password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <button className="btn-add" onClick={handleChangePassword}>Update</button>
                    </div>
                </div>
            )}

            {/* --- ADMIN PANEL VIEW --- */}
            {viewAdmin && user.role === 'admin' ? (
                <>
                    <div className="admin-controls" style={{marginTop:0, marginBottom:'2rem'}}>
                        <h2>Manage Team</h2>
                        <div className="input-group">
                            <input placeholder="New Name" value={newUser} onChange={e => setNewUser(e.target.value)} />
                            <button className="btn-add" onClick={handleCreateUser}>Add Person</button>
                        </div>
                        <div style={{display:'flex', flexDirection:'column', gap:'5px', marginTop:'10px'}}>
                            {userList.map(u => (
                                <div key={u.username} style={{display:'flex', justifyContent:'space-between', background:'#f9f9f9', padding:'5px 10px', borderRadius:'5px'}}>
                                    <span style={{fontWeight:'bold'}}>{u.username}</span>
                                    <div>
                                        {u.username !== 'admin' && u.username !== user.username && (
                                            <>
                                            <button onClick={() => handlePromote(u.username)} style={{fontSize:'0.6rem', background:'var(--success)', color:'white', marginRight:'5px'}}>Promote</button>
                                            <button onClick={() => handleDeleteUser(u.username)} style={{fontSize:'0.6rem', background:'var(--danger)', color:'white'}}>X</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="admin-controls">
                        <h2>Control Panel</h2>
                        <div className="danger-zone">
                            <button onClick={toggleVoting} style={{background: status ? '#4caf50' : '#555', color:'white'}}>
                                {status ? '🔓 Open Voting' : '🔒 Close Voting'}
                            </button>
                            <button className="btn-danger" onClick={handleReset}>🔄 New Week</button>
                        </div>
                    </div>

                    <h2>Current Menu</h2>
                    <div className="admin-controls" style={{padding:'1rem', marginBottom:'1rem'}}>
                        <div className="input-group" style={{flexDirection:'column'}}>
                            <input placeholder="Dish Name" value={newFood} onChange={e => setNewFood(e.target.value)} style={{width:'100%'}} />
                            <input type="file" onChange={e => setNewImage(e.target.files[0])} style={{width:'100%', border:'1px solid #ddd', padding:'10px', borderRadius:'10px'}} />
                            <button className="btn-add" style={{width:'100%'}} onClick={handleAddFood}>Add Food</button>
                        </div>
                    </div>
                </>
            ) : (
                /* --- VOTING VIEW --- */
                <>
                    <p>Welcome, <span style={{color:'var(--primary)', fontWeight:'bold'}}>{user.username}</span>!</p>
                    {status && <p className="message-box" style={{color:'orange'}}>Voting is currently CLOSED</p>}

                    <div className="food-grid">
                        {food.map(f => (
                            <div key={f.id} className="food-card">
                                {f.image_url && <img src={f.image_url} className="food-image" alt={f.name} />}
                                <div className="card-content">
                                    <div className="food-name">{f.name}</div>
                                    <div className="vote-count">{f.votes} Votes</div>
                                    
                                    {user.role === 'admin' ? (
                                        <button className="btn-remove" onClick={() => axios.post('/admin/remove', { id: f.id })}>Remove</button>
                                    ) : (
                                        <button className="btn-vote" disabled={status} onClick={() => handleVote(f.id)} style={{opacity: status ? 0.5 : 1}}>
                                            Vote 😋
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}