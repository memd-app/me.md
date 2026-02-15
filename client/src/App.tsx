import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import NotFoundPage from '@/pages/NotFoundPage';
import PlaceholderPage from '@/pages/PlaceholderPage';

function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100">
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected app routes */}
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="topics" element={<PlaceholderPage title="Topics" icon="📋" description="Manage your interview topics and knowledge areas." />} />
            <Route path="topics/:id" element={<PlaceholderPage title="Topic Detail" icon="📋" />} />
            <Route path="session/new" element={<PlaceholderPage title="New Session" icon="💬" description="Start a new AI-guided interview session." />} />
            <Route path="session/:id" element={<PlaceholderPage title="Interview Session" icon="💬" />} />
            <Route path="graph" element={<PlaceholderPage title="Knowledge Graph" icon="🔗" description="Visualize connections between your topics and insights." />} />
            <Route path="profile" element={<PlaceholderPage title="Profile Summary" icon="👤" description="Your auto-generated personal profile." />} />
            <Route path="verify" element={<PlaceholderPage title="Verification Queue" icon="✅" description="Review and verify AI-extracted insights." />} />
            <Route path="sandbox" element={<PlaceholderPage title="Context Sandbox" icon="🧪" description="Test how your personal context improves AI outputs." />} />
            <Route path="bookmarks" element={<PlaceholderPage title="Bookmarks" icon="⭐" description="Your saved aha moments from interview sessions." />} />
            <Route path="search" element={<PlaceholderPage title="Search" icon="🔍" description="Search across topics, insights, and session transcripts." />} />
            <Route path="export" element={<PlaceholderPage title="Export" icon="📤" description="Export your verified profile as me.md or JSON." />} />
            <Route path="settings" element={<PlaceholderPage title="Settings" icon="⚙️" description="Manage your account, preferences, and privacy." />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </AuthProvider>
  );
}

export default App;
