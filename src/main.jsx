import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './themes/ThemeContext'
import { WorkspaceProvider } from './workspace/WorkspaceContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorkspaceProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </WorkspaceProvider>
  </StrictMode>,
)
