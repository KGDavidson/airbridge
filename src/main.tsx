import { createRoot } from 'react-dom/client'
import './index.css'
import "./init"
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import NotFound from './NotFound.tsx';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<App />} />
    </ Routes>
  </ BrowserRouter>
)
