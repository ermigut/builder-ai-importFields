import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ConfigBuilderPage from './pages/ConfigBuilderPage';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/config"
        element={
          <ProtectedRoute>
            <ConfigBuilderPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/config" replace />} />
    </Routes>
  );
}

export default App;
