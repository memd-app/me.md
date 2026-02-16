import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';

// Global fetch interceptor: automatically inject Bearer token on API requests
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Only intercept API requests to our backend
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.startsWith('/api')) {
    const token = localStorage.getItem('memd_auth_token');
    if (token) {
      const headers = new Headers(init?.headers);
      // Only set Authorization if not already present
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      init = { ...init, headers };
    }
  }
  return originalFetch.call(window, input, init);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
