import React from 'react'
import ReactDOM from 'react-dom/client'
import GameApp from './game/ui/GameApp.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameApp />
  </React.StrictMode>,
)
