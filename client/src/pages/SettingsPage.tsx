import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Theme</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Choose light or dark mode</p>
              </div>
              <select className="input-field w-auto">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
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
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">MCP Access Permissions</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Control which AI agents can access your verified personal context.
          </p>
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">No MCP connections configured yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}
