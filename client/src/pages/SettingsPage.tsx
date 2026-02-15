import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

const API_BASE = '/api';

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
  { key: 'email', label: 'Email', editable: false },
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

  const handleAddAgent = async () => {
    if (!user?.id || !newAgentName.trim()) return;
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

  const handleToggleAgent = async (permissionId: string, currentEnabled: boolean) => {
    if (!user?.id) return;
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

  const handleDeleteAgent = async (permissionId: string) => {
    if (!user?.id) return;
    setMcpError(null);
    setMcpSuccess(null);
    const perm = mcpPermissions.find((p) => p.id === permissionId);
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
      setConfirmDelete(null);
      setMcpSuccess(`Agent "${perm?.agentName || ''}" access revoked`);
      setTimeout(() => setMcpSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      setMcpError(message);
      setTimeout(() => setMcpError(null), 5000);
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
        <p className="mt-1 text-gray-600 dark:text-gray-400">
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
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
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
                        <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
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
                                type={field.type === 'date' ? 'date' : 'text'}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="input-field max-w-sm"
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
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Member Since
                  </label>
                  <p className="text-gray-900 dark:text-gray-100">
                    {formatDate(profile.createdAt)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">Unable to load profile data.</p>
            )}
          </div>

          {/* Danger Zone */}
          <div className="card border-red-200 dark:border-red-800">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Danger Zone</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
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
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Preferences</h2>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Theme</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
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
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Session Length</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Default interview session duration</p>
              </div>
              <select className="input-field w-auto">
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'privacy' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Privacy Settings</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Control which knowledge items are included in exports. Items marked as &quot;never export&quot; will be excluded from all export formats.
          </p>
        </div>
      )}

      {activeTab === 'mcp' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">MCP Access Permissions</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Enter the name of the AI agent or application that should have access to your personal context.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="e.g., Claude Desktop, Cursor, Custom Bot"
                    className="input-field flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newAgentName.trim()) handleAddAgent();
                      if (e.key === 'Escape') { setShowAddForm(false); setNewAgentName(''); }
                    }}
                  />
                  <button
                    onClick={handleAddAgent}
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
                <p className="text-gray-500 dark:text-gray-400 font-medium">No MCP connections configured yet</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
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
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {perm.isEnabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                          <span>Added: {formatMcpDate(perm.createdAt)}</span>
                          <span>Last accessed: {formatMcpDate(perm.lastAccessedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {/* Toggle switch */}
                        <button
                          onClick={() => handleToggleAgent(perm.id, perm.isEnabled)}
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
                        {confirmDelete === perm.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteAgent(perm.id)}
                              className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 font-medium px-2 py-1 rounded bg-red-50 dark:bg-red-900/20"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(perm.id)}
                            className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
                            title="Revoke agent access"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
}
