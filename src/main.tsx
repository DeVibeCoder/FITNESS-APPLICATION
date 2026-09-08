import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import { watchForUpdates } from './lib/appUpdate'

/*
 * Before React, so the `controller` reading happens while it still means
 * something — a worker can claim this page at any point after registration.
 */
watchForUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
