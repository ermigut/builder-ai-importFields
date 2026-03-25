import { Routes, Route, Navigate } from 'react-router-dom';
import ConfigBuilderPage from './pages/ConfigBuilderPage';
import './App.css';

function App() {
  return (
    <Routes>
      <Route path="/config" element={<ConfigBuilderPage />} />
      <Route path="/" element={<Navigate to="/config" replace />} />
    </Routes>
  );
}

export default App;
