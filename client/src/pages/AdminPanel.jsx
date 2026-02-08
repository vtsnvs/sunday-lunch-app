import { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { AuthContext } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

const SOCKET_URL = import.meta.env.VITE_API_URL 
    ? import.meta.env.VITE_API_URL.replace('/api', '') 
    : "http://localhost:3000";

const socket = io(SOCKET_URL, { withCredentials: true });

// --- HELPER COMPONENT (Moved Outside to prevent flickering/loss of focus) ---
const FoodCard = ({ f, onEdit, onToggle, onRemove }) => (
    <div className={`food-card ${!f.is_active ? 'inactive' : ''}`}>
        {f.image_url && <img src={f.image_url} className="food-image" alt={f.name} />}
        <div className="card-content">
            <div className="food-name">{f.name} {f.is_active ? '' : '(Disabled)'}</div>
            <div className="vote-count">{f.votes} Votes</div>
            <div style={{fontSize:'0.8rem', color:'#888', margin:'5px 0'}}>
                {f.options && f.options.length > 0 ? f.options.join(', ') : 'No options'}
            </div>
            
            <div style={{display:'flex', gap:'10px', marginTop:'auto', flexWrap:'wrap'}}>
                <button 
                    className="btn-secondary" 
                    style={{flex:1, fontSize:'0.8rem'}}
                    onClick={() => onEdit(f)}
                >
                    Edit ✏️
                </button>
                <button 
                    className={f.is_active ? "btn-warning" : "btn-success"} 
                    style={{flex:1, fontSize:'0.8rem'}}
                    onClick={() => onToggle(f.id, f.is_active)}
                >
                    {f.is_active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn-danger" style={{flex:1, fontSize:'0.8rem'}} onClick={() => onRemove(f.id)}>
                    Delete
                </button>
            </div>
        </div>
    </div>
);

// --- MAIN COMPONENT ---
export default function AdminPanel() {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();
    const [food, setFood] = useState([]);
    const [status, setStatus] = useState(false);
    const [userList, setUserList] = useState([]);
    const [orders, setOrders] = useState([]);
    
    // State for shelf toggle and search
    const [showArchived, setShowArchived] = useState(false);
    const [shelfSearch, setShelfSearch] = useState(""); 
    
    const fileInputRef = useRef(null);

    // Inputs
    const [newFood, setNewFood] = useState("");
    const [newImage, setNewImage] = useState(null);
    const [foodOptions, setFoodOptions] = useState([]); 
    const [optionInput, setOptionInput] = useState("");
    const [editingId, setEditingId] = useState(null); 
    
    const [newUser, setNewUser] = useState("");
    const [newPass, setNewPass] = useState("");
    const [showPassModal, setShowPassModal] = useState(false);

    const isSuperAdmin = user.username === 'admin';

    // Filter Logic
    const activeFood = food.filter(f => f.is_active);
    const inactiveFood = food.filter(f => !f.is_active);

    useEffect(() => {
        fetchData();
        fetchOrders();
        if(isSuperAdmin) fetchUsers();

        socket.on('update', (data) => {
            if (data.type === 'menu' || data.type === 'votes' || data.type === 'reset') {
                fetchData();
                fetchOrders();
            }
            if (data.type === 'users' && isSuperAdmin) fetchUsers();
        });
        socket.on('status_change', (data) => setStatus(data.closed));
        return () => { socket.off('update'); socket.off('status_change'); };
    }, [isSuperAdmin]);

    const fetchData = () => {
        axios.get('/food').then(res => setFood(res.data?.items || [])).catch(console.error);
        axios.get('/status').then(res => setStatus(res.data.closed));
    };

    const fetchUsers = () => {
        axios.get('/users/list').then(res => setUserList(res.data)).catch(console.error);
    };

    const fetchOrders = () => {
        axios.get('/admin/orders').then(res => setOrders(res.data)).catch(console.error);
    };

    // --- ACTIONS ---
    const handleChangePassword = async () => {
        if (!newPass) return;
        try {
            await axios.post('/auth/change-password', { newPassword: newPass });
            alert("Password updated!");
            setShowPassModal(false);
            setNewPass("");
        } catch(e) { alert("Failed to update"); }
    };

    const handleAddOption = () => {
        if(optionInput.trim()) {
            setFoodOptions([...foodOptions, optionInput.trim()]);
            setOptionInput("");
        }
    };

    const handleRemoveOption = (idx) => {
        setFoodOptions(foodOptions.filter((_, i) => i !== idx));
    };

    const handleEdit = (item) => {
        setEditingId(item.id);
        setNewFood(item.name);
        setFoodOptions(item.options || []);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setNewFood("");
        setNewImage(null);
        setFoodOptions([]);
        if(fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleSaveFood = async () => {
        if (!newFood.trim()) {
            return alert("Please enter a food name!");
        }

        const formData = new FormData();
        formData.append('name', newFood.trim());
        if (newImage) formData.append('image', newImage);
        formData.append('options', JSON.stringify(foodOptions));
        
        try {
            if (editingId) {
                await axios.put(`/admin/food/${editingId}`, formData);
                setEditingId(null);
            } else {
                await axios.post('/admin/food', formData);
            }
            
            setNewFood(""); 
            setNewImage(null);
            setFoodOptions([]);
            if(fileInputRef.current) fileInputRef.current.value = "";
        } catch (e) {
            alert("Error saving food item");
        }
    };

    const handleRemove = async (id) => {
        if(confirm("Permanently DELETE this item?")) await axios.post('/admin/remove', { id });
    };

    const handleToggleFood = async (id, currentStatus) => {
        await axios.post('/admin/food/toggle', { id, is_active: !currentStatus });
    };

    const handleCreateUser = async () => {
        if (!newUser.trim()) {
            return alert("Please enter a username!");
        }
        try {
            await axios.post('/admin/users', { username: newUser.trim(), role: 'user' });
            alert(`User "${newUser}" created successfully! ✅`);
            setNewUser("");
        } catch (e) {
            alert(e.response?.data?.message || "Failed to create user. Name might be taken.");
        }
    };

    const handleDeleteUser = async (username) => {
        if(confirm(`Delete ${username}?`)) await axios.post('/admin/delete-user', { username });
    };

    const handlePromote = async (username) => {
        if(confirm(`Promote ${username}?`)) {
            await axios.post('/admin/role', { username, role: 'admin' });
            setUserList(prev => prev.map(u => u.username === username ? {...u, role: 'admin'} : u));
        }
    };

    const handleDemote = async (username) => {
        if(confirm(`Demote ${username}?`)) {
            await axios.post('/admin/role', { username, role: 'user' });
            setUserList(prev => prev.map(u => u.username === username ? {...u, role: 'user'} : u));
        }
    };

    const toggleVoting = async () => await axios.post('/admin/toggle', { closed: !status });
    const handleReset = async () => { if(confirm("Reset votes for a new week?")) await axios.post('/admin/reset'); };
    const handleNuke = async () => { if(confirm("⚠️ WARNING: This will delete ALL food items. Are you sure?")) await axios.post('/admin/nuke'); };

    // Common Style for Section Headers
    const SectionHeader = ({ title, icon }) => (
        <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px', marginTop:'10px', borderBottom:'2px solid #f0f0f0', paddingBottom:'10px'}}>
            <h3 style={{margin:0, color:'var(--text-dark)', fontSize:'1.3rem'}}>{icon} {title}</h3>
        </div>
    );

    return (
        <div className="container">
            <div className="flex-between" style={{marginBottom:'2rem'}}>
                <h1>👑 Chef's Table</h1>
                <div style={{display:'flex', gap:'10px'}}>
                    <button onClick={() => setShowPassModal(!showPassModal)} className="btn-outline">
                        {showPassModal ? 'Cancel' : 'Change PW'}
                    </button>
                    <button onClick={() => { logout(); navigate('/'); }} className="btn-secondary">Logout</button>
                </div>
            </div>

            {/* PASSWORD MODAL */}
            {showPassModal && (
                <div className="card" style={{border:'2px solid var(--primary)'}}>
                    <h3>Change My Password</h3>
                    <div className="form-grid">
                        <input type="password" placeholder="New Password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <button className="btn-success" onClick={handleChangePassword}>Update</button>
                    </div>
                </div>
            )}

            {/* CONTROLS */}
            <div className="card">
                <h2>Control Panel</h2>
                <div style={{display:'flex', gap:'10px', flexWrap:'wrap'}}>
                    <button onClick={toggleVoting} style={{flex:'1', background: status ? '#2ed573' : '#ff4757', color:'white', minWidth:'140px'}}>
                        {status ? '🔓 Open Voting' : '🔒 Close Voting'}
                    </button>
                    <button className="btn-warning" style={{flex:'1', minWidth:'140px'}} onClick={handleReset}>🔄 Reset Week</button>
                    {isSuperAdmin && (
                        <button className="btn-danger" style={{flex:'1', minWidth:'140px', background:'black'}} onClick={handleNuke}>🔥 Nuke</button>
                    )}
                </div>
            </div>

            {/* ORDER MANIFEST */}
            <div className="card">
                <h2>📋 Order Manifest</h2>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Food</th>
                                <th>Extras</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((o, i) => (
                                <tr key={i}>
                                    <td style={{fontWeight:'600'}}>{o.username}</td>
                                    <td>{o.food_name}</td>
                                    <td>
                                        {o.selections && o.selections.length > 0 ? (
                                            o.selections.map((sel, idx) => (
                                                <span key={idx} className="badge badge-admin" style={{marginRight:'5px', background:'#e3f2fd', color:'#0d47a1'}}>{sel}</span>
                                            ))
                                        ) : <span style={{color:'#ccc'}}>-</span>}
                                    </td>
                                    <td style={{color:'#666', fontSize:'0.9rem'}}>{o.notes || '-'}</td>
                                </tr>
                            ))}
                            {orders.length === 0 && <tr><td colSpan="4" style={{textAlign:'center', color:'#888', padding:'20px'}}>No orders yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* FOOD MANAGEMENT */}
            <div className="card">
                <div className="flex-between">
                    <h2>{editingId ? 'Edit Food Item' : 'Add New Food'}</h2>
                    {editingId && <button className="btn-outline" onClick={handleCancelEdit}>Cancel Edit</button>}
                </div>
                
                {/* Form to Add/Edit Food */}
                <div style={{display:'flex', flexDirection:'column', gap:'20px', marginBottom:'40px'}}>
                    <div className="form-grid">
                        <input placeholder="Dish Name (e.g. Burger)" value={newFood} onChange={e => setNewFood(e.target.value)} />
                        <button 
                            className={editingId ? "btn-warning" : "btn-primary"} 
                            onClick={handleSaveFood}
                        >
                            {editingId ? 'Update Food' : 'Add Food'}
                        </button>
                    </div>
                    
                    <div style={{background:'#f9f9f9', padding:'15px', borderRadius:'10px'}}>
                        <h4 style={{marginBottom:'10px'}}>Options (e.g. Fries, Spicy)</h4>
                        <div className="form-grid">
                            <input 
                                placeholder="Option Name..." 
                                value={optionInput} 
                                onChange={e => setOptionInput(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && handleAddOption()}
                            />
                            <button className="btn-secondary" onClick={handleAddOption}>+ Add Option</button>
                        </div>
                        <div style={{display:'flex', gap:'5px', flexWrap:'wrap', marginTop:'5px'}}>
                            {foodOptions.map((opt, i) => (
                                <span key={i} className="badge" style={{background:'#ddd', padding:'5px 10px', display:'flex', alignItems:'center', gap:'5px'}}>
                                    {opt} <span style={{cursor:'pointer', fontWeight:'bold'}} onClick={() => handleRemoveOption(i)}>×</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <input type="file" ref={fileInputRef} onChange={e => setNewImage(e.target.files[0])} />
                </div>
                
                {/* 1. ACTIVE ITEMS SECTION */}
                <SectionHeader title="Active Menu" icon="🍽️" />
                
                {activeFood.length === 0 ? (
                    <p style={{color:'#888', fontStyle:'italic', textAlign:'center', padding:'20px'}}>
                        No active items. Add some above or enable from archive.
                    </p>
                ) : (
                    <div className="food-grid">
                        {activeFood.map(f => (
                            <FoodCard 
                                key={f.id} f={f} 
                                onEdit={handleEdit} 
                                onToggle={handleToggleFood} 
                                onRemove={handleRemove} 
                            />
                        ))}
                    </div>
                )}

                {/* 2. SHELVED (DISABLED) ITEMS SECTION */}
                {inactiveFood.length > 0 && (
                    <div style={{marginTop: '50px'}}>
                        <SectionHeader title="Archive (Shelved)" icon="🗄️" />
                        
                        <button 
                            onClick={() => setShowArchived(!showArchived)} 
                            className="btn-secondary" 
                            style={{width: '100%', marginBottom:'20px'}}
                        >
                            {showArchived ? 'Hide Shelved Items' : `Show Shelved Items (${inactiveFood.length})`}
                        </button>
                        
                        {showArchived && (
                            <div className="fade-in">
                                <input
                                    placeholder="🔍 Search shelved items..."
                                    value={shelfSearch}
                                    onChange={e => setShelfSearch(e.target.value)}
                                    style={{ marginBottom: '20px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', width:'100%' }} 
                                />

                                <div className="food-grid" style={{opacity: 0.85}}>
                                    {inactiveFood
                                        .filter(f => f.name.toLowerCase().includes(shelfSearch.toLowerCase()))
                                        .map(f => (
                                            <FoodCard 
                                                key={f.id} f={f} 
                                                onEdit={handleEdit} 
                                                onToggle={handleToggleFood} 
                                                onRemove={handleRemove} 
                                            />
                                        ))
                                    }
                                    {inactiveFood.filter(f => f.name.toLowerCase().includes(shelfSearch.toLowerCase())).length === 0 && (
                                        <p style={{color:'#888', textAlign:'center'}}>No items found matching "{shelfSearch}"</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* SUPERADMIN TEAM MGMT */}
            {isSuperAdmin && (
                <div className="card">
                    <div className="flex-between" style={{marginBottom:'15px'}}>
                        <h2>Manage Team</h2>
                        <div style={{flexGrow:1, maxWidth:'400px'}}>
                            <div className="form-grid">
                                <input placeholder="New Team Member Name" value={newUser} onChange={e => setNewUser(e.target.value)} />
                                <button className="btn-success" onClick={handleCreateUser}>+ Add</button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="table-wrapper">
                        <table>
                            <thead><tr><th>Name</th><th>Role</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
                            <tbody>
                                {userList.map(u => (
                                    <tr key={u.username}>
                                        <td style={{fontWeight:'600'}}>{u.username}</td>
                                        <td><span className={`badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>{u.role === 'admin' ? 'Admin' : 'User'}</span></td>
                                        <td style={{textAlign:'right'}}>
                                            <div style={{display:'flex', justifyContent:'flex-end', gap:'5px'}}>
                                                {u.role !== 'admin' ? (
                                                    <button onClick={() => handlePromote(u.username)} className="btn-success btn-icon">Promote ⬆</button>
                                                ) : (
                                                    <button onClick={() => handleDemote(u.username)} className="btn-warning btn-icon">Demote ⬇</button>
                                                )}
                                                <button onClick={() => handleDeleteUser(u.username)} className="btn-danger btn-icon">✕</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}