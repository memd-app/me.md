import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { UserProvider, useUser } from '@/contexts/UserContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import OnboardingGuard from '@/components/auth/OnboardingGuard';
import AppLayout from '@/components/layout/AppLayout';
import OnboardingPage from '@/pages/OnboardingPage';
import DashboardPage from '@/pages/DashboardPage';
import TopicsPage from '@/pages/TopicsPage';
import KnowledgeGraphPage from '@/pages/KnowledgeGraphPage';
import ProfilePage from '@/pages/ProfilePage';
import VerificationPage from '@/pages/VerificationPage';
import BookmarksPage from '@/pages/BookmarksPage';
import SearchPage from '@/pages/SearchPage';
import ExportPage from '@/pages/ExportPage';
import SettingsPage from '@/pages/SettingsPage';
import NotFoundPage from '@/pages/NotFoundPage';
import CreateTopicPage from '@/pages/CreateTopicPage';
import TopicDetailPage from '@/pages/TopicDetailPage';
import SessionPage from '@/pages/SessionPage';
import ChatPage from '@/pages/ChatPage';
import TemplatesPage from '@/pages/TemplatesPage';
import NotesPage from '@/pages/NotesPage';
import ImportPage from '@/pages/ImportPage';
import AssessmentPage from '@/pages/AssessmentPage';
import AssessmentResultsPage from '@/pages/AssessmentResultsPage';
import AssessmentHistoryPage from '@/pages/AssessmentHistoryPage';

// Param-preserving redirects for renamed routes (old deep links keep working)
function LegacySessionRedirect() {
  const { id } = useParams()
  return <Navigate to={`/app/sessions/${id}`} replace />
}

function LegacyResultsRedirect() {
  const { attemptId } = useParams()
  return <Navigate to={`/app/personality/${attemptId}/results`} replace />
}

function RootRedirect() {
  const { user, isLoading } = useUser()
  if (isLoading) return null
  return user ? <Navigate to="/dashboard" replace /> : <Navigate to="/onboarding" replace />
}

function App() {
  return (
    <ErrorBoundary>
    <UserProvider>
      <ThemeProvider>
      <ToastProvider>
      <div className="min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100">
        <Routes>
          {/* Root redirect: user exists → dashboard, otherwise → onboarding */}
          <Route path="/" element={<RootRedirect />} />

          {/* Onboarding */}
          <Route path="/onboarding" element={<OnboardingPage />} />

          {/* App routes (with onboarding guard) */}
          <Route
            path="/app"
            element={
              <OnboardingGuard>
                <AppLayout />
              </OnboardingGuard>
            }
          >
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="topics" element={<TopicsPage />} />
            <Route path="topics/new" element={<CreateTopicPage />} />
            <Route path="topics/:id" element={<TopicDetailPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="session/new" element={<Navigate to="/app/topics" replace />} />
            <Route path="sessions/:id" element={<SessionPage />} />
            {/* Legacy singular form — canonicalized to /app/sessions/:id */}
            <Route path="session/:id" element={<LegacySessionRedirect />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="notes/bookmarks" element={<BookmarksPage />} />
            <Route path="graph" element={<KnowledgeGraphPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="review" element={<VerificationPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="verify" element={<Navigate to="/app/review" replace />} />
            <Route path="bookmarks" element={<Navigate to="/app/notes/bookmarks" replace />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="personality" element={<AssessmentPage />} />
            <Route path="personality/history" element={<AssessmentHistoryPage />} />
            <Route path="personality/:attemptId/results" element={<AssessmentResultsPage />} />
            {/* Legacy assessment routes */}
            <Route path="assessment" element={<Navigate to="/app/personality" replace />} />
            <Route path="assessment/history" element={<Navigate to="/app/personality/history" replace />} />
            <Route path="assessment/:attemptId/results" element={<LegacyResultsRedirect />} />
            {/* Catch-all for unknown /app/* routes */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* Convenience top-level redirect for /dashboard */}
          <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
      </ToastProvider>
      </ThemeProvider>
    </UserProvider>
    </ErrorBoundary>
  );
}

export default App;
