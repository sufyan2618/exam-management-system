import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const build = new URL(import.meta.url).pathname.split("/").pop() ?? "";
  void navigator.serviceWorker.register("/sw.js?build=" + encodeURIComponent(build))
    .catch(() => { /* The app can still run without its offline shell. */ });
}