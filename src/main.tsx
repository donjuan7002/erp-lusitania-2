import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Se importa antes que nada para no perder el aviso de «se puede instalar».
import './lib/instalacion'
import App from './App'
import './estilos.css'

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
