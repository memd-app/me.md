import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // If user hasn't completed onboarding, redirect to onboarding
  if (user && !user.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
