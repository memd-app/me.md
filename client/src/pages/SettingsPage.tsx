import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

const API_BASE = '/api';

// ============================================
// Privacy Tab Component
// ============================================
interface PrivacyInsightItem {
  id: string;
  content: string;
  privacyTier: string;
  verificationStatus: string;
  topicTitle: string | null;
  confidenceScore: number | null;
}

function PrivacyTab({ userId }: { userId: string }) {
  const [insights, setInsights] = useState<PrivacyInsightItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'exportable' | 'never_export'>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/insights?status=verified`, {
        headers: { 'x-user-id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setInsights((data.insights || []).map((i: PrivacyInsightItem) => ({
          id: i.id,
          content: i.content,
          privacyTier: i.privacyTier || 'exportable',
          verificationStatus: i.verificationStatus,
          topicTitle: i.topicTitle || null,
          confidenceScore: i.confidenceScore,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch insights for privacy:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const togglePrivacyTier = async (insightId: string, currentTier: string) => {
    if (!userId) return;
    const newTier = currentTier === 'exportable' ? 'never_export' : 'exportable';
    setTogglingId(insightId);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/insights/${insightId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ privacyTier: newTier }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update privacy tier');
      }
      setInsights(prev => prev.map(i =>
        i.id === insightId ? { ...i, privacyTier: newTier } : i
      ));
      setStatus({
        type: 'success',
        message: `Insight marked as "${newTier === 'never_export' ? 'Never Export' : 'Exportable'}"`,
      });
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update';
      setStatus({ type: 'error', message });
    } finally {
      setTogglingId(null);
    }
  };

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter(i => i.privacyTier === filter);

  const exportableCount = insights.filter(i => i.privacyTier === 'exportable').length;
  const neverExportCount = insights.filter(i => i.privacyTier === 'never_export').length;

  return (
    <div className="space-y-6">
      {/* Privacy overview card */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Privacy Settings</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Control which verified insights are included in exports. Items marked as &quot;Never Export&quot; will be
          excluded from all export formats, MCP access, and profile sharing.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{insights.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-300">Total Verified</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{exportableCount}</p>
            <p className="text-xs text-green-600 dark:text-green-400">Exportable</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{neverExportCount}</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Never Export</p>
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            status.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}>
            {status.message}
          </div>
        )}

        {/* Filter buttons */}
        <div className="flex gap-2 mb-4">
          {(['all', 'exportable', 'never_export'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all' ? `All (${insights.length})` :
               f === 'exportable' ? `Exportable (${exportableCount})` :
               `Never Export (${neverExportCount})`}
            </button>
          ))}
        </div>

        {/* Insights list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse flex items-center gap-3 py-3">
                <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-6 w-12 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : filteredInsights.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-300">
              {insights.length === 0
                ? 'No verified insights yet. Verify insights to manage their privacy settings.'
                : 'No insights match this filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {filteredInsights.map((insight) => (
              <div key={insight.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 line-clamp-2">
                      {insight.content}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-300">
                      {insight.topicTitle && <span>Topic: {insight.topicTitle}</span>}
                      {insight.confidenceScore != null && <span>Confidence: {insight.confidenceScore}%</span>}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        insight.privacyTier === 'never_export'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      }`}>
                        {insight.privacyTier === 'never_export' ? 'Never Export' : 'Exportable'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => togglePrivacyTier(insight.id, insight.privacyTier)}
                    disabled={togglingId === insight.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                      insight.privacyTier === 'exportable' ? 'bg-green-500' : 'bg-amber-500'
                    } ${togglingId === insight.id ? 'opacity-50' : ''}`}
                    role="switch"
                    aria-checked={insight.privacyTier === 'exportable'}
                    title={insight.privacyTier === 'exportable' ? 'Click to mark as Never Export' : 'Click to mark as Exportable'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        insight.privacyTier === 'exportable' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export exclusion info */}
      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>How it works:</strong> Items marked as &quot;Never Export&quot; are automatically excluded from:
          profile exports (Markdown and JSON), clipboard copy, MCP tool access, and the context testing sandbox.
          Only verified insights with the &quot;Exportable&quot; tier are shared.
        </p>
      </div>
    </div>
  );
}

interface ProfileData {
  name: string;
  email: string;
  dateOfBirth: string;
  location: string;
  occupation: string;
  gender: string;
  createdAt: string;
}

interface EditableField {
  key: keyof ProfileData;
  label: string;
  editable: boolean;
  type?: string;
}

interface McpPermission {
  id: string;
  userId: string;
  agentName: string;
  isEnabled: boolean;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROFILE_FIELDS: EditableField[] = [
  { key: 'name', label: 'Name', editable: true },
  { key: 'email', label: 'Email', editable: true, type: 'email' },
  { key: 'dateOfBirth', label: 'Date of Birth', editable: true, type: 'date' },
  { key: 'location', label: 'Location', editable: true },
  { key: 'occupation', label: 'Occupation', editable: true },
  { key: 'gender', label: 'Gender', editable: true },
];

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('account');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Session length and notification preferences state
  const [sessionLength, setSessionLength] = useState<number>(15);
  const [notifications, setNotifications] = useState({
    sessionReminders: true,
    verificationAlerts: true,
    insightUpdates: false,
  });
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsStatus, setPrefsStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Change password state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // MCP permissions state
  const [mcpPermissions, setMcpPermissions] = useState<McpPermission[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpSuccess, setMcpSuccess] = useState<string | null>(null);
  const [addingAgent, setAddingAgent] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; agentName: string; currentEnabled: boolean } | null>(null);
  const [confirmAddAgent, setConfirmAddAgent] = useState(false);

  // MCP Tools test state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; content: string; confidenceScore: number; verifiedAt: string; topicTitle: string; topicId: string }> | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [contextSummary, setContextSummary] = useState<{ content: string; totalInsights: number; topics: string[] } | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const tabs = [
    { id: 'account', label: 'Account' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'mcp', label: 'MCP Access' },
  ];

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/users/profile`, {
        headers: { 'x-user-id': user.id },
      });
      if (res.ok) {
        const data = await res.json();
        setProfile({
          name: data.user.name || '',
          email: data.user.email || '',
          dateOfBirth: data.user.dateOfBirth || '',
          location: data.user.location || '',
          occupation: data.user.occupation || '',
          gender: data.user.gender || '',
          createdAt: data.user.createdAt || '',
        });
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Sync session length and notification prefs from user profile
  useEffect(() => {
    if (user?.sessionLengthDefault) {
      setSessionLength(user.sessionLengthDefault);
    }
    if (user?.notificationPreferences) {
      try {
        const parsed = typeof user.notificationPreferences === 'string'
          ? JSON.parse(user.notificationPreferences)
          : user.notificationPreferences;
        setNotifications((prev) => ({ ...prev, ...parsed }));
      } catch {
        // ignore parse errors
      }
    }
  }, [user?.sessionLengthDefault, user?.notificationPreferences]);

  // MCP permissions management
  const fetchMcpPermissions = useCallback(async () => {
    if (!user?.id) return;
    setMcpLoading(true);
    try {
      const res = await fetch(`${API_BASE}/mcp/permissions`, {
        headers: { 'x-user-id': user.id },
      });
      if (res.ok) {
        const data = await res.json();
        setMcpPermissions(data.permissions || []);
      }
    } catch (err) {
      console.error('Failed to fetch MCP permissions:', err);
    } finally {
      setMcpLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'mcp') {
      fetchMcpPermissions();
    }
  }, [activeTab, fetchMcpPermissions]);

  const requestAddAgent = () => {
    if (!newAgentName.trim()) return;
    setConfirmAddAgent(true);
  };

  const handleAddAgentConfirmed = async () => {
    if (!user?.id || !newAgentName.trim()) return;
    setConfirmAddAgent(false);
    setAddingAgent(true);
    setMcpError(null);
    setMcpSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/mcp/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ agentName: newAgentName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add agent');
      }
      const data = await res.json();
      setMcpPermissions((prev) => [data.permission, ...prev]);
      setNewAgentName('');
      setShowAddForm(false);
      setMcpSuccess(`Agent "${data.permission.agentName}" added successfully`);
      setTimeout(() => setMcpSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add agent';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
    } finally {
      setAddingAgent(false);
    }
  };

  const requestToggleAgent = (permissionId: string, agentName: string, currentEnabled: boolean) => {
    setConfirmToggle({ id: permissionId, agentName, currentEnabled });
  };

  const handleToggleAgentConfirmed = async () => {
    if (!user?.id || !confirmToggle) return;
    const { id: permissionId, currentEnabled } = confirmToggle;
    setConfirmToggle(null);
    setMcpError(null);
    setMcpSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/mcp/permissions/${permissionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ isEnabled: !currentEnabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update permission');
      }
      const data = await res.json();
      setMcpPermissions((prev) =>
        prev.map((p) => (p.id === permissionId ? data.permission : p))
      );
      const action = !currentEnabled ? 'enabled' : 'disabled';
      setMcpSuccess(`Agent "${data.permission.agentName}" ${action}`);
      setTimeout(() => setMcpSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update permission';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
    }
  };

  const handleDeleteAgentConfirmed = async () => {
    if (!user?.id || !confirmDelete) return;
    const permissionId = confirmDelete;
    const perm = mcpPermissions.find((p) => p.id === permissionId);
    setConfirmDelete(null);
    setMcpError(null);
    setMcpSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/mcp/permissions/${permissionId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke access');
      }
      setMcpPermissions((prev) => prev.filter((p) => p.id !== permissionId));
      setMcpSuccess(`Agent "${perm?.agentName || ''}" access revoked`);
      setTimeout(() => setMcpSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
    }
  };

  const handleSearchKnowledge = async () => {
    if (!user?.id || !searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResults(null);
    try {
      const res = await fetch(`${API_BASE}/mcp/tools/search?q=${encodeURIComponent(searchQuery.trim())}&userId=${user.id}`, {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Search failed');
      }
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleGetContextSummary = async () => {
    if (!user?.id) return;
    setContextLoading(true);
    setContextSummary(null);
    try {
      const res = await fetch(`${API_BASE}/mcp/tools/context-summary?userId=${user.id}`, {
        headers: { 'x-user-id': user.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to get context summary');
      }
      const data = await res.json();
      setContextSummary({ content: data.content, totalInsights: data.totalInsights, topics: data.topics });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get context summary';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
    } finally {
      setContextLoading(false);
    }
  };

  const formatMcpDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Never';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const startEditing = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
    setSaveStatus(null);
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveField = async (fieldKey: string) => {
    if (!user?.id || !profile) return;

    // Client-side email validation
    if (fieldKey === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(editValue.trim())) {
        setSaveStatus({ type: 'error', message: 'Please enter a valid email address' });
        return;
      }
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      const res = await fetch(`${API_BASE}/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ [fieldKey]: editValue.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save changes');
      }

      // Update local profile state
      setProfile((prev) => prev ? { ...prev, [fieldKey]: editValue.trim() } : null);

      // Update AuthContext user state so it reflects elsewhere in the app
      updateUser({ [fieldKey]: editValue.trim() });

      setEditingField(null);
      setEditValue('');

      const fieldLabel = PROFILE_FIELDS.find((f) => f.key === fieldKey)?.label || fieldKey;
      setSaveStatus({ type: 'success', message: `${fieldLabel} updated successfully` });

      // Clear success message after 3 seconds
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      setSaveStatus({ type: 'error', message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!user?.id) return;

    setPasswordError(null);
    setPasswordSuccess(null);

    // Client-side validation
    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }
    if (!/\d/.test(newPassword)) {
      setPasswordError('New password must contain at least one number');
      return;
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword)) {
      setPasswordError('New password must contain at least one special character');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsChangingPassword(true);

    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change password');
      }

      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setTimeout(() => {
        setPasswordSuccess(null);
        setShowChangePassword(false);
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      setPasswordError(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.id) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      // Verify password first
      const verifyRes = await fetch(`${API_BASE}/auth/verify-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ password: deletePassword }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || 'Password verification failed');
      }

      // Delete account
      const deleteRes = await fetch(`${API_BASE}/auth/account`, {
        method: 'DELETE',
        headers: {
          'x-user-id': user.id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: deletePassword }),
      });

      if (!deleteRes.ok) {
        const data = await deleteRes.json();
        throw new Error(data.error || 'Failed to delete account');
      }

      // Log out and redirect
      logout();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete account';
      setDeleteError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const saveSessionLength = async (newLength: number) => {
    if (!user?.id) return;
    setSessionLength(newLength);
    setPrefsSaving(true);
    setPrefsStatus(null);
    try {
      const res = await fetch(`${API_BASE}/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ sessionLengthDefault: newLength }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save session length');
      }
      updateUser({ sessionLengthDefault: newLength });
      setPrefsStatus({ type: 'success', message: 'Session length updated' });
      setTimeout(() => setPrefsStatus(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setPrefsStatus({ type: 'error', message });
    } finally {
      setPrefsSaving(false);
    }
  };

  const saveNotificationPref = async (key: string, value: boolean) => {
    if (!user?.id) return;
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    setPrefsSaving(true);
    setPrefsStatus(null);
    try {
      const res = await fetch(`${API_BASE}/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ notificationPreferences: updated }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save notification preferences');
      }
      updateUser({ notificationPreferences: JSON.stringify(updated) });
      setPrefsStatus({ type: 'success', message: 'Notification preference updated' });
      setTimeout(() => setPrefsStatus(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setPrefsStatus({ type: 'error', message });
    } finally {
      setPrefsSaving(false);
    }
  };

  const formatDisplayValue = (field: EditableField, value: string): string => {
    if (!value || value === 'Unknown' || value === 'unspecified') return 'Not set';
    if (field.key === 'dateOfBirth' && value !== 'Not set') {
      try {
        const date = new Date(value + 'T00:00:00');
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch {
        return value;
      }
    }
    if (field.key === 'gender') {
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
    return value;
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'Unknown';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          Manage your account, preferences, and privacy
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-dark-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Status message */}
      {saveStatus && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            saveStatus.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          {saveStatus.message}
        </div>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Account Information</h2>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="animate-pulse flex items-center justify-between py-3">
                    <div>
                      <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                      <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : profile ? (
              <div className="divide-y divide-gray-100 dark:divide-dark-border">
                {PROFILE_FIELDS.map((field) => (
                  <div key={field.key} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <label className="block text-sm font-medium text-gray-500 dark:text-gray-300 mb-1">
                          {field.label}
                        </label>

                        {editingField === field.key ? (
                          <div className="flex items-center gap-2">
                            {field.key === 'gender' ? (
                              <select
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="input-field w-auto min-w-[200px]"
                              >
                                <option value="">Select gender</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="non-binary">Non-binary</option>
                                <option value="other">Other</option>
                                <option value="prefer-not-to-say">Prefer not to say</option>
                              </select>
                            ) : (
                              <input
                                type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="input-field max-w-sm"
                                placeholder={field.type === 'email' ? 'Enter new email address' : undefined}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveField(field.key);
                                  if (e.key === 'Escape') cancelEditing();
                                }}
                              />
                            )}
                            <button
                              onClick={() => saveField(field.key)}
                              disabled={isSaving || !editValue.trim()}
                              className="btn-primary text-sm px-3 py-1.5"
                            >
                              {isSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="btn-secondary text-sm px-3 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-gray-900 dark:text-gray-100">
                            {formatDisplayValue(field, profile[field.key])}
                          </p>
                        )}
                      </div>

                      {field.editable && editingField !== field.key && (
                        <button
                          onClick={() => startEditing(field.key, profile[field.key])}
                          className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium ml-4"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Member since */}
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-300 mb-1">
                    Member Since
                  </label>
                  <p className="text-gray-900 dark:text-gray-100">
                    {formatDate(profile.createdAt)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-300">Unable to load profile data.</p>
            )}
          </div>

          {/* Change Password */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Password</h2>
              {!showChangePassword && (
                <button
                  onClick={() => {
                    setShowChangePassword(true);
                    setPasswordError(null);
                    setPasswordSuccess(null);
                  }}
                  className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
                >
                  Change Password
                </button>
              )}
            </div>

            {!showChangePassword ? (
              <p className="text-sm text-gray-500 dark:text-gray-300">
                Update your password to keep your account secure.
              </p>
            ) : (
              <div className="space-y-3">
                {passwordSuccess && (
                  <div className="p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                    {passwordSuccess}
                  </div>
                )}
                {passwordError && (
                  <div className="p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                    {passwordError}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(null); }}
                    className="input-field max-w-sm"
                    placeholder="Enter current password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null); }}
                    className="input-field max-w-sm"
                    placeholder="Min 8 chars, 1 number, 1 special char"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => { setConfirmNewPassword(e.target.value); setPasswordError(null); }}
                    className="input-field max-w-sm"
                    placeholder="Re-enter new password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && currentPassword && newPassword && confirmNewPassword) {
                        handleChangePassword();
                      }
                    }}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleChangePassword}
                    disabled={isChangingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                    className="btn-primary text-sm"
                  >
                    {isChangingPassword ? 'Changing...' : 'Update Password'}
                  </button>
                  <button
                    onClick={() => {
                      setShowChangePassword(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setPasswordError(null);
                      setPasswordSuccess(null);
                    }}
                    className="btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="card border-red-200 dark:border-red-800">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Danger Zone</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn-danger"
              >
                Delete Account
              </button>
            ) : (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-3">
                  Are you sure? This will permanently delete your account and all data (topics, sessions, insights, notes, etc.).
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                  Enter your password to confirm:
                </p>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(null); }}
                  placeholder="Enter your password"
                  className="input-field max-w-sm mb-3"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deletePassword) handleDeleteAccount();
                  }}
                />
                {deleteError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-3">{deleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeleting || !deletePassword}
                    className="btn-danger text-sm"
                  >
                    {isDeleting ? 'Deleting...' : 'Yes, Delete My Account'}
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeletePassword('');
                      setDeleteError(null);
                    }}
                    className="btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* Preferences status message */}
          {prefsStatus && (
            <div
              className={`p-3 rounded-lg text-sm ${
                prefsStatus.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}
            >
              {prefsStatus.message}
            </div>
          )}

          {/* Appearance */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Appearance</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Theme</p>
                <p className="text-sm text-gray-500 dark:text-gray-300">
                  Current theme: <span className="font-medium capitalize">{theme}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Sun icon */}
                <svg
                  className={`w-5 h-5 transition-colors ${theme === 'light' ? 'text-amber-500' : 'text-gray-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                {/* Toggle switch */}
                <button
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                    theme === 'dark' ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={theme === 'dark'}
                  aria-label="Toggle dark mode"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                {/* Moon icon */}
                <svg
                  className={`w-5 h-5 transition-colors ${theme === 'dark' ? 'text-primary-400' : 'text-gray-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Session Settings */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Session Settings</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Session Length</p>
                <p className="text-sm text-gray-500 dark:text-gray-300">Default interview session duration</p>
              </div>
              <select
                className="input-field w-auto"
                value={sessionLength}
                onChange={(e) => saveSessionLength(Number(e.target.value))}
                disabled={prefsSaving}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          {/* Notification Preferences */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Notifications</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Session Reminders</p>
                  <p className="text-sm text-gray-500 dark:text-gray-300">Get reminded about scheduled interview sessions</p>
                </div>
                <button
                  onClick={() => saveNotificationPref('sessionReminders', !notifications.sessionReminders)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                    notifications.sessionReminders ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={notifications.sessionReminders}
                  disabled={prefsSaving}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      notifications.sessionReminders ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Verification Alerts</p>
                  <p className="text-sm text-gray-500 dark:text-gray-300">Get notified when insights need re-verification</p>
                </div>
                <button
                  onClick={() => saveNotificationPref('verificationAlerts', !notifications.verificationAlerts)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                    notifications.verificationAlerts ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={notifications.verificationAlerts}
                  disabled={prefsSaving}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      notifications.verificationAlerts ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Insight Updates</p>
                  <p className="text-sm text-gray-500 dark:text-gray-300">Get notified about new insights from sessions</p>
                </div>
                <button
                  onClick={() => saveNotificationPref('insightUpdates', !notifications.insightUpdates)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                    notifications.insightUpdates ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={notifications.insightUpdates}
                  disabled={prefsSaving}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      notifications.insightUpdates ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'privacy' && (
        <PrivacyTab userId={user?.id || ''} />
      )}

      {activeTab === 'mcp' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">MCP Access Permissions</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Control which AI agents can access your verified personal context via the Model Context Protocol.
                </p>
              </div>
              {!showAddForm && (
                <button
                  onClick={() => { setShowAddForm(true); setMcpError(null); }}
                  className="btn-primary text-sm flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Agent
                </button>
              )}
            </div>

            {/* Status messages */}
            {mcpSuccess && (
              <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                {mcpSuccess}
              </div>
            )}
            {mcpError && (
              <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                {mcpError}
              </div>
            )}

            {/* Add Agent Form */}
            {showAddForm && (
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-dark-border">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Add New Agent Connection</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 mb-3">
                  Enter the name of the AI agent or application that should have access to your personal context.
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="mcp-agent-name" className="sr-only">Agent name</label>
                  <input
                    id="mcp-agent-name"
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="e.g., Claude Desktop, Cursor, Custom Bot"
                    className="input-field flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newAgentName.trim()) requestAddAgent();
                      if (e.key === 'Escape') { setShowAddForm(false); setNewAgentName(''); }
                    }}
                  />
                  <button
                    onClick={requestAddAgent}
                    disabled={addingAgent || !newAgentName.trim()}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    {addingAgent ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setNewAgentName(''); }}
                    className="btn-secondary text-sm px-4 py-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Permissions List */}
            {mcpLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex items-center justify-between py-4 border-b border-gray-100 dark:border-dark-border">
                    <div>
                      <div className="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                      <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                    </div>
                    <div className="h-6 w-12 bg-gray-200 dark:bg-gray-700 rounded-full" />
                  </div>
                ))}
              </div>
            ) : mcpPermissions.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <p className="text-gray-500 dark:text-gray-300 font-medium">No MCP connections configured yet</p>
                <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">
                  Add an AI agent to allow it to access your verified personal context.
                </p>
                {!showAddForm && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="mt-4 btn-primary text-sm"
                  >
                    Add Your First Agent
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-dark-border">
                {mcpPermissions.map((perm) => (
                  <div key={perm.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900 dark:text-white truncate">
                            {perm.agentName}
                          </h3>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              perm.isEnabled
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                            }`}
                          >
                            {perm.isEnabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-300">
                          <span>Added: {formatMcpDate(perm.createdAt)}</span>
                          <span>Last accessed: {formatMcpDate(perm.lastAccessedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {/* Toggle switch */}
                        <button
                          onClick={() => requestToggleAgent(perm.id, perm.agentName, perm.isEnabled)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                            perm.isEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          role="switch"
                          aria-checked={perm.isEnabled}
                          title={perm.isEnabled ? 'Disable agent access' : 'Enable agent access'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              perm.isEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        {/* Delete button */}
                        <button
                          onClick={() => setConfirmDelete(perm.id)}
                          className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
                          title="Revoke agent access"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* MCP Tools Test */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">MCP Tools</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Test the MCP tools that AI agents use to access your verified context.
            </p>

            {/* search_knowledge tool */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">search_knowledge</h3>
              <p className="text-xs text-gray-500 dark:text-gray-300 mb-2">
                Search across your verified, exportable insights by keyword.
              </p>
              <div className="flex items-center gap-2 mb-3">
                <label htmlFor="mcp-search-query" className="sr-only">Search your verified knowledge</label>
                <input
                  id="mcp-search-query"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter search query..."
                  className="input-field flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) handleSearchKnowledge();
                  }}
                />
                <button
                  onClick={handleSearchKnowledge}
                  disabled={searchLoading || !searchQuery.trim()}
                  className="btn-primary text-sm px-4 py-2"
                >
                  {searchLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              {searchResults !== null && (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-dark-border p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-300 mb-2">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                  </p>
                  {searchResults.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-300 italic">No matching verified insights found.</p>
                  ) : (
                    <div className="space-y-2">
                      {searchResults.map((r) => (
                        <div key={r.id} className="bg-white dark:bg-gray-900 rounded p-2 border border-gray-100 dark:border-gray-700">
                          <p className="text-sm text-gray-900 dark:text-gray-100">{r.content}</p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-300">
                            <span>Topic: {r.topicTitle || 'Unknown'}</span>
                            <span>Confidence: {r.confidenceScore}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* get_context_summary tool */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">get_context_summary</h3>
              <p className="text-xs text-gray-500 dark:text-gray-300 mb-2">
                Generate a portable markdown summary of your verified personal context.
              </p>
              <button
                onClick={handleGetContextSummary}
                disabled={contextLoading}
                className="btn-primary text-sm px-4 py-2 mb-3"
              >
                {contextLoading ? 'Generating...' : 'Generate Context Summary'}
              </button>
              {contextSummary && (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-dark-border p-3">
                  <div className="flex items-center gap-3 mb-2 text-xs text-gray-500 dark:text-gray-300">
                    <span>{contextSummary.totalInsights} verified insight{contextSummary.totalInsights !== 1 ? 's' : ''}</span>
                    <span>{contextSummary.topics.length} topic{contextSummary.topics.length !== 1 ? 's' : ''}</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-mono bg-white dark:bg-gray-900 rounded p-3 border border-gray-100 dark:border-gray-700 max-h-64 overflow-y-auto">
                    {contextSummary.content}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* MCP Info Card */}
          <div className="card bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">About MCP Access</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              The Model Context Protocol (MCP) allows AI agents to access your verified personal context.
              Only verified insights with the &quot;exportable&quot; privacy tier will be shared.
              Items marked as &quot;never export&quot; are always excluded.
            </p>
            <ul className="mt-2 text-sm text-blue-600 dark:text-blue-400 list-disc list-inside space-y-1">
              <li>Enable or disable access for each agent individually</li>
              <li>Revoke access at any time by deleting the connection</li>
              <li>Track when each agent last accessed your data</li>
            </ul>
          </div>
        </div>
      )}
      {/* MCP Confirmation Dialogs */}

      {/* Confirm Add Agent Dialog */}
      {confirmAddAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="confirm-add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-dialog-title">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h3 id="add-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">Enable Agent Access</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              Are you sure you want to grant MCP access to:
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-2 mb-4">
              {newAgentName.trim()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-6">
              This agent will be able to access your verified, exportable personal context through the Model Context Protocol.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAddAgent(false)}
                className="btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleAddAgentConfirmed}
                className="btn-primary text-sm px-4 py-2"
              >
                Confirm & Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Toggle Agent Dialog */}
      {confirmToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="confirm-toggle-dialog" role="dialog" aria-modal="true" aria-labelledby="toggle-dialog-title">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                confirmToggle.currentEnabled
                  ? 'bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-green-100 dark:bg-green-900/30'
              }`}>
                <svg className={`w-5 h-5 ${
                  confirmToggle.currentEnabled
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-600 dark:text-green-400'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {confirmToggle.currentEnabled ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  )}
                </svg>
              </div>
              <h3 id="toggle-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                {confirmToggle.currentEnabled ? 'Disable' : 'Enable'} Agent Access
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              {confirmToggle.currentEnabled
                ? 'Are you sure you want to disable MCP access for:'
                : 'Are you sure you want to enable MCP access for:'}
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-2 mb-4">
              {confirmToggle.agentName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-6">
              {confirmToggle.currentEnabled
                ? 'This agent will no longer be able to access your personal context until re-enabled.'
                : 'This agent will be able to access your verified, exportable personal context through MCP.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmToggle(null)}
                className="btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleAgentConfirmed}
                className={`text-sm px-4 py-2 rounded-lg font-medium text-white ${
                  confirmToggle.currentEnabled
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {confirmToggle.currentEnabled ? 'Disable Access' : 'Enable Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Agent Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="confirm-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 id="delete-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">Revoke Agent Access</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              Are you sure you want to permanently revoke MCP access for:
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-2 mb-4">
              {mcpPermissions.find((p) => p.id === confirmDelete)?.agentName || 'Unknown agent'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-6">
              This will permanently remove this agent connection. You can add it again later if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAgentConfirmed}
                className="btn-danger text-sm px-4 py-2"
              >
                Revoke Access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
