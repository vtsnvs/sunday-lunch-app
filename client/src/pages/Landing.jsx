import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Landing() {
    const navigate = useNavigate();
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState("");

    useEffect(() => {
        axios.get('http://localhost:3000/api/users/list')
            .then(res => setUsers(res.data)) 
            .catch(err => console.error("Failed to load users", err));
    }, []);

    const handleVoteClick = () => {
        if (selectedUser) {
            navigate(`/login?username=${encodeURIComponent(selectedUser)}`, { state: { target: '/voting' } });
        }
    };

    const handleAdminClick = () => {
        // Pass selected username even for admin login
        const query = selectedUser ? `?username=${encodeURIComponent(selectedUser)}` : '';
        navigate(`/login${query}`, { state: { target: '/admin-panel' } });
    };

    return (
        <div className="container centered-layout">
            <h1 style={{fontSize:'3rem', marginBottom:'3rem'}}>🍽️ Sunday Lunch</h1>
            
            <div className="card" style={{width:'100%', maxWidth:'400px', textAlign:'center'}}>
                <h2>Who are you?</h2>
                <div style={{display:'flex', flexDirection:'column', gap:'20px', marginTop:'20px'}}>
                    <select 
                        value={selectedUser} 
                        onChange={(e) => setSelectedUser(e.target.value)}
                        style={{padding:'16px', fontSize:'1.1rem'}}
                    >
                        <option value="" disabled>Select your name...</option>
                        {users.map(u => (
                            <option key={u.username} value={u.username}>{u.username}</option>
                        ))}
                    </select>
                    
                    <button 
                        onClick={handleVoteClick} 
                        className="btn-vote" 
                        disabled={!selectedUser}
                        style={{padding:'16px', fontSize:'1.1rem'}}
                    >
                        Let's Eat! 🚀
                    </button>
                </div>
            </div>

            <div style={{marginTop: '3rem', textAlign:'center', opacity:0.8}}>
                <button onClick={handleAdminClick} className="btn-outline" style={{borderRadius:'50px'}}>
                    Go to Admin Panel 👑
                </button>
            </div>
        </div>
    );
}