import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import OnboardingGuard from '@/components/auth/OnboardingGuard';
import AppLayout from '@/components/layout/AppLayout';
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import OnboardingPage from '@/pages/OnboardingPage';
import DashboardPage from '@/pages/DashboardPage';
import TopicsPage from '@/pages/TopicsPage';
import NewSessionPage from '@/pages/NewSessionPage';
import KnowledgeGraphPage from '@/pages/KnowledgeGraphPage';
import ProfilePage from '@/pages/ProfilePage';
import VerificationPage from '@/pages/VerificationPage';
import SandboxPage from '@/pages/SandboxPage';
import BookmarksPage from '@/pages/BookmarksPage';
import SearchPage from '@/pages/SearchPage';
import ExportPage from '@/pages/ExportPage';
import SettingsPage from '@/pages/SettingsPage';
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

          {/* Onboarding (protected, but no onboarding guard) */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          {/* Protected app routes (with onboarding guard) */}
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <OnboardingGuard>
                  <AppLayout />
                </OnboardingGuard>
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="topics" element={<TopicsPage />} />
            <Route path="topics/:id" element={<PlaceholderPage title="Topic Detail" icon="📋" />} />
            <Route path="session/new" element={<NewSessionPage />} />
            <Route path="session/:id" element={<PlaceholderPage title="Interview Session" icon="💬" />} />
            <Route path="graph" element={<KnowledgeGraphPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="verify" element={<VerificationPage />} />
            <Route path="sandbox" element={<SandboxPage />} />
            <Route path="bookmarks" element={<BookmarksPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </AuthProvider>
  );
}

export default App;
