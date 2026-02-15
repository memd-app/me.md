import { Routes, Route } from 'react-router-dom';

function App() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100">
      <Routes>
        <Route path="/" element={<div>me.md - Landing Page</div>} />
        <Route path="/login" element={<div>Login</div>} />
        <Route path="/register" element={<div>Register</div>} />
        <Route path="/app/*" element={<div>App Layout</div>} />
        <Route path="*" element={<div>404 - Page Not Found</div>} />
      </Routes>
    </div>
  );
}

export default App;
