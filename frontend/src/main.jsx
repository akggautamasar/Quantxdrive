import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ChannelsLauncher from './ChannelsLauncher.jsx'
import { installPdfReaderBridge } from './PdfReaderBridge.jsx'

function Root() {
  const token = localStorage.getItem('ad_token') || ''
  return <><App /><ChannelsLauncher token={token} /></>
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

installPdfReaderBridge()
