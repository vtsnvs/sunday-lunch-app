import { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Voting from './pages/Voting';
import AdminPanel from './pages/AdminPanel';

// Guard for Regular Users (and Admins who want to vote)
function ProtectedRoute({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/" />;
  return children;
}

// Guard for Admin Panel
function AdminRoute({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div>Loading...</div>;
  if (!user || user.role !== 'admin') return <Navigate to="/" />;
  return children;
}

function AppContent() {
  const { user } = useContext(AuthContext);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      
      {/* SEPARATE ROUTES */}
      <Route path="/voting" element={<ProtectedRoute><Voting /></ProtectedRoute>} />
      <Route path="/admin-panel" element={<AdminRoute><AdminPanel /></AdminRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}