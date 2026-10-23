import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toasts';
import Home from './pages/Home';
import RoomPage from './pages/RoomPage';

// Two pages: the landing page and a room. /room/:id is the shareable link.
export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:id" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
