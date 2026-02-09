import { useState, useContext, useEffect } from 'react';
import { AuthContext } from '../AuthContext';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';

export default function Login() {
    const { login, logout } = useContext(AuthContext);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showHint, setShowHint] = useState(false);
    const [isLoading, setIsLoading] = useState(false); // ADDED: Loading State

    const targetPath = location.state?.target || '/voting';

    useEffect(() => {
        const userParam = searchParams.get('username');
        if (userParam) {
            setUsername(userParam);
            checkPasswordStatus(userParam);
        }
    }, [searchParams]);

    const checkPasswordStatus = async (user) => {
        try {
            const res = await axios.get(`/users/status/${user}`);
            setShowHint(res.data.isDefault);
        } catch(e) { console.error(e); }
    };

    const handleBlur = () => { if(username) checkPasswordStatus(username); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setIsLoading(true); // Start loading
        try {
            const user = await login(username, password);
            
            if (targetPath === '/admin-panel' && user.role !== 'admin') {
                await logout();
                setError("Access Denied: You do not have Admin privileges.");
                setIsLoading(false);
                return;
            }

            navigate(targetPath);
        } catch (err) {
            setError(err.response?.data?.message || "Login failed");
            setIsLoading(false); // Stop loading on error
        }
    };

    return (
        <div className="container centered-layout">
            <h1 style={{marginBottom:'2rem'}}>🔐 Login</h1>
            <div className="card" style={{width:'100%', maxWidth:'400px'}}>
                <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:'15px'}}>
                    <div>
                        <label style={{fontSize:'0.9rem', color:'#666'}}>Username</label>
                        <input 
                            type="text" value={username}
                            onChange={e => setUsername(e.target.value)} onBlur={handleBlur}
                            required
                            readOnly={!!searchParams.get('username')}
                            style={{ backgroundColor: searchParams.get('username') ? '#f0f0f0' : 'white' }}
                        />
                    </div>
                    <div>
                        <label style={{fontSize:'0.9rem', color:'#666'}}>Password</label>
                        <input 
                            type="password" value={password}
                            onChange={e => setPassword(e.target.value)} required
                        />
                    </div>
                    <button 
                        type="submit" 
                        className="btn-primary" 
                        style={{marginTop:'10px'}}
                        disabled={isLoading}
                    >
                        {isLoading ? <><span className="spinner"></span> Logging in...</> : 'Login'}
                    </button>
                </form>
                
                {showHint && (
                    <div style={{ marginTop: '20px', padding: '15px', background: '#e3f2fd', borderRadius: '12px', color: '#0d47a1', fontSize:'0.9rem' }}>
                        ℹ️ <strong>First time here?</strong><br/>
                        Your default password is: <strong>admin</strong>
                    </div>
                )}
                
                {error && <div className="message-box" style={{background:'#fee2e2', color:'#b91c1c', marginTop:'20px'}}>{error}</div>}
                
                <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', marginTop: '15px', width:'100%' }}>
                    ← Back to List
                </button>
            </div>
        </div>
    );
}