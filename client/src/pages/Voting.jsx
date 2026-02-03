import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { AuthContext } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

const SOCKET_URL = import.meta.env.VITE_API_URL 
    ? import.meta.env.VITE_API_URL.replace('/api', '') 
    : "http://localhost:3000";

const socket = io(SOCKET_URL, { withCredentials: true });

export default function Voting() {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();
    const [food, setFood] = useState([]);
    const [votedId, setVotedId] = useState(null); 
    const [status, setStatus] = useState(false);
    const [favorites, setFavorites] = useState([]); 
    const [isLoading, setIsLoading] = useState(true); // ADDED: Loading State
    
    const [orderState, setOrderState] = useState({});
    const [newPass, setNewPass] = useState("");
    const [showPassModal, setShowPassModal] = useState(false);
    const [showFavModal, setShowFavModal] = useState(false);

    useEffect(() => {
        fetchData();
        fetchFavorites();

        socket.on('update', (data) => {
            if (data.type === 'menu' || data.type === 'votes' || data.type === 'reset') fetchData();
        });
        socket.on('status_change', (data) => setStatus(data.closed));
        return () => { socket.off('update'); socket.off('status_change'); };
    }, []);

    const fetchData = () => {
        // setIsLoading(true); // Optional: Use this if you want spinner on every real-time update, but might flicker
        axios.get('/food').then(res => {
            const items = res.data.items || [];
            const activeItems = items.filter(f => f.is_active); 
            setFood(activeItems);
            
            const myVote = res.data.voteData;
            if (myVote) {
                setVotedId(myVote.food_id);
                setOrderState(prev => ({
                    ...prev,
                    [myVote.food_id]: { 
                        selected: myVote.selections || [],
                        notes: myVote.notes || '' 
                    }
                }));
            }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false)); // Turn off loading

        axios.get('/status').then(res => setStatus(res.data.closed));
    };

    const fetchFavorites = () => {
        axios.get('/favorites').then(res => setFavorites(res.data)).catch(console.error);
    };

    const toggleFavorite = async (foodId) => {
        try {
            const res = await axios.post('/favorites', { food_id: foodId });
            if (res.data.added) {
                setFavorites([...favorites, foodId]);
            } else {
                setFavorites(favorites.filter(id => id !== foodId));
            }
        } catch (e) { console.error(e); }
    };

    const toggleOption = (foodId, option) => {
        const current = orderState[foodId]?.selected || [];
        const newSelected = current.includes(option)
            ? current.filter(o => o !== option)
            : [...current, option];
            
        setOrderState(prev => ({
            ...prev,
            [foodId]: { ...prev[foodId], selected: newSelected }
        }));
    };

    const handleNoteChange = (foodId, txt) => {
        setOrderState(prev => ({
            ...prev,
            [foodId]: { ...prev[foodId], notes: txt }
        }));
    };

    const handleVote = async (id) => {
        const state = orderState[id] || {};
        try {
            await axios.post('/vote', { 
                food_id: id,
                selections: state.selected || [],
                notes: state.notes || ''
            });
            
            if (votedId) {
                alert("Order updated successfully! ✅");
            } else {
                alert("Order placed successfully! 🚀");
            }

            setVotedId(id);
        } catch (e) { alert(e.response.data.message); }
    };

    const handleChangePassword = async () => {
        if (!newPass) return;
        try {
            await axios.post('/auth/change-password', { newPassword: newPass });
            alert("Password updated!");
            setShowPassModal(false);
            setNewPass("");
        } catch(e) { alert("Failed to update"); }
    };

    const favItems = food.filter(f => favorites.includes(f.id));

    if (isLoading) {
        return <div className="container centered-layout"><h2>Loading deliciousness... 🍔</h2></div>;
    }

    return (
        <div className="container">
            <div className="flex-between" style={{marginBottom:'2rem'}}>
                <h1>🍽️ Sunday Lunch</h1>
                <div style={{display:'flex', gap:'10px'}}>
                    <button onClick={() => setShowFavModal(true)} className="btn-outline" style={{padding:'8px 12px', fontSize:'1.2rem', color: favorites.length > 0 ? 'var(--danger)' : '#aaa'}}>
                        ❤️
                    </button>
                    <button onClick={() => setShowPassModal(!showPassModal)} className="btn-outline">Change PW</button>
                    <button onClick={() => { logout(); navigate('/'); }} className="btn-secondary">Logout</button>
                </div>
            </div>

            {/* FAVORITES MODAL */}
            {showFavModal && (
                <div className="modal-overlay" onClick={() => setShowFavModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <button className="close-modal" onClick={() => setShowFavModal(false)}>×</button>
                        <h2 style={{marginBottom:'20px'}}>❤️ Your Favorites</h2>
                        
                        {favItems.length === 0 ? (
                            <p style={{textAlign:'center', color:'#888'}}>No favorites yet.</p>
                        ) : (
                            <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                                {favItems.map(f => (
                                    <div key={f.id} className="fav-item">
                                        {f.image_url && <img src={f.image_url} alt={f.name} />}
                                        <div style={{flexGrow:1}}>
                                            <div style={{fontWeight:'bold'}}>{f.name}</div>
                                        </div>
                                        <button 
                                            className="btn-vote" 
                                            style={{padding:'6px 12px', fontSize:'0.8rem', width:'auto'}}
                                            onClick={() => { setShowFavModal(false); handleVote(f.id); }}
                                            disabled={status}
                                        >
                                            Vote
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showPassModal && (
                <div className="card">
                    <h3>Change Password</h3>
                    <div style={{display:'flex', gap:'10px', marginTop:'15px'}}>
                        <input type="password" placeholder="New Password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <button className="btn-success" onClick={handleChangePassword}>Update</button>
                    </div>
                </div>
            )}

            <p style={{textAlign:'center', fontSize:'1.1rem', marginBottom:'2rem'}}>
                Welcome, <span style={{color:'var(--primary)', fontWeight:'bold'}}>{user.username}</span>!
            </p>
            
            {status && <div className="message-box" style={{background:'#fff3cd', color:'#856404', marginBottom:'20px'}}>Voting is currently CLOSED 🔒</div>}

            <div className="food-grid">
                {food.map(f => {
                    const state = orderState[f.id] || { selected: [], notes: '' };
                    const isFav = favorites.includes(f.id);
                    return (
                        <div key={f.id} className={`food-card ${votedId === f.id ? 'voted' : ''}`}>
                            <button 
                                className={`fav-btn ${isFav ? 'active' : ''}`} 
                                onClick={(e) => { e.stopPropagation(); toggleFavorite(f.id); }}
                            >
                                {isFav ? '❤️' : '🤍'}
                            </button>

                            {f.image_url && <img src={f.image_url} className="food-image" alt={f.name} />}
                            <div className="card-content">
                                <div className="food-name" style={{textAlign:'center', marginBottom:'10px'}}>{f.name}</div>

                                {f.options && f.options.length > 0 && (
                                    <div className="options-grid">
                                        {f.options.map((opt, i) => (
                                            <label key={i} className="option-label">
                                                <input 
                                                    type="checkbox" 
                                                    checked={state.selected.includes(opt)} 
                                                    onChange={() => toggleOption(f.id, opt)}
                                                    disabled={status}
                                                />
                                                <span>{opt}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                
                                <input 
                                    className="note-input"
                                    type="text" 
                                    placeholder="Notes..." 
                                    value={state.notes}
                                    onChange={e => handleNoteChange(f.id, e.target.value)}
                                    disabled={status}
                                />

                                <button 
                                    className="btn-vote" 
                                    disabled={status} 
                                    onClick={() => handleVote(f.id)}
                                    style={{marginTop:'10px', background: votedId === f.id ? 'var(--success)' : ''}}
                                >
                                    {votedId === f.id ? 'Update Order ✅' : 'Order This'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}