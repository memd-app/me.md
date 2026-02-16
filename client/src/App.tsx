import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
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
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import CreateTopicPage from '@/pages/CreateTopicPage';
import TopicDetailPage from '@/pages/TopicDetailPage';
import SessionPage from '@/pages/SessionPage';
import TemplatesPage from '@/pages/TemplatesPage';
import NotesPage from '@/pages/NotesPage';
import ImportPage from '@/pages/ImportPage';

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
      <div className="min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100">
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

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
            <Route path="topics/new" element={<CreateTopicPage />} />
            <Route path="topics/:id" element={<TopicDetailPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="session/new" element={<NewSessionPage />} />
            <Route path="session/:id" element={<SessionPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="graph" element={<KnowledgeGraphPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="verify" element={<VerificationPage />} />
            <Route path="sandbox" element={<SandboxPage />} />
            <Route path="bookmarks" element={<BookmarksPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
