import { Navigate } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';

export default function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user } = useUser();

  // If user hasn't completed onboarding, redirect to onboarding
  if (user && !user.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
