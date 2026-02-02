import { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    axios.defaults.withCredentials = true;
    axios.defaults.baseURL = "http://localhost:3000/api";

    useEffect(() => {
        axios.get('/me')
            .then(res => setUser(res.data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const login = async (username, password) => {
        const res = await axios.post('/login', { username, password });
        setUser(res.data.user);
        return res.data.user; // Return user so Login page can check role
    };

    const logout = async () => {
        await axios.post('/logout');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};