/**
 * Shared VerifiedBadge component for consistent display of verification status
 * across all views in the application.
 *
 * Renders the Modern Editorial typographic status treatment (small caps +
 * accent/muting, no colored pill background — see DESIGN.md "Status
 * semantics") via the shared ui/Badge component.
 */
import Badge from '@/components/ui/Badge';

interface VerifiedBadgeProps {
  status: string; // 'verified' | 'unverified' | 'rejected' | 're_verification_pending'
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<string, {
  variant: 'verified' | 'pending' | 'rejected' | 'neutral';
  label: string;
}> = {
  verified: {
    variant: 'verified',
    label: 'Verified',
  },
  rejected: {
    variant: 'rejected',
    label: 'Rejected',
  },
  re_verification_pending: {
    variant: 'pending',
    label: 'Re-verify',
  },
  unverified: {
    variant: 'neutral',
    label: 'Pending',
  },
};

export default function VerifiedBadge({ status, size = 'sm', showLabel = true }: VerifiedBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unverified;

  return (
    <Badge variant={config.variant} label={showLabel ? config.label : ''} size={size} />
  );
}
