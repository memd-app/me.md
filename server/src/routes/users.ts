import { Router } from 'express';
import { db } from '../config/database.js';
import { users } from '../models/schema.js';
import { eq } from 'drizzle-orm';

export const usersRouter = Router();

// GET /api/users/profile - Get current user's profile
usersRouter.get('/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't return password_hash
    const { passwordHash: _ph, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /api/users/profile - Update profile fields
usersRouter.put('/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, dateOfBirth, location, occupation, gender, themePreference } = req.body;

    // Validate required fields
    const errors: string[] = [];
    if (name !== undefined && (!name || name.trim().length === 0)) {
      errors.push('Name is required');
    }
    if (dateOfBirth !== undefined && (!dateOfBirth || dateOfBirth.trim().length === 0)) {
      errors.push('Date of birth is required');
    }
    if (location !== undefined && (!location || location.trim().length === 0)) {
      errors.push('Location is required');
    }
    if (occupation !== undefined && (!occupation || occupation.trim().length === 0)) {
      errors.push('Occupation is required');
    }
    if (gender !== undefined && (!gender || gender.trim().length === 0)) {
      errors.push('Gender is required');
    }

    // Validate theme preference
    if (themePreference !== undefined && !['light', 'dark'].includes(themePreference)) {
      errors.push('Theme preference must be "light" or "dark"');
    }

    // Validate date format if provided
    if (dateOfBirth && dateOfBirth.trim().length > 0) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateOfBirth)) {
        errors.push('Date of birth must be in YYYY-MM-DD format');
      } else {
        const date = new Date(dateOfBirth);
        if (isNaN(date.getTime())) {
          errors.push('Invalid date of birth');
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', '), errors });
    }

    // Build update object with only provided fields
    const updateData: Record<string, string> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (occupation !== undefined) updateData.occupation = occupation.trim();
    if (gender !== undefined) updateData.gender = gender.trim();
    if (themePreference !== undefined) updateData.themePreference = themePreference;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Update the user
    const updatedUser = db.update(users)
      .set({ ...updateData, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .returning()
      .get();

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't return password_hash
    const { passwordHash: _ph, ...userWithoutPassword } = updatedUser;

    res.json({ message: 'Profile updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/users/onboarding/complete - Mark onboarding as complete
usersRouter.put('/onboarding/complete', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const updatedUser = db.update(users)
      .set({ onboardingCompleted: true, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .returning()
      .get();

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { passwordHash: _ph, ...userWithoutPassword } = updatedUser;

    res.json({ message: 'Onboarding completed', user: userWithoutPassword });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

// POST /api/users/onboarding - Save onboarding data (profile fields)
usersRouter.post('/onboarding', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, dateOfBirth, location, occupation, gender } = req.body;

    // Validate all required fields
    const errors: string[] = [];
    if (!name || name.trim().length === 0) errors.push('Name is required');
    if (!dateOfBirth || dateOfBirth.trim().length === 0) errors.push('Date of birth is required');
    if (!location || location.trim().length === 0) errors.push('Location is required');
    if (!occupation || occupation.trim().length === 0) errors.push('Occupation is required');
    if (!gender || gender.trim().length === 0) errors.push('Gender is required');

    // Validate date format
    if (dateOfBirth && dateOfBirth.trim().length > 0) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateOfBirth)) {
        errors.push('Date of birth must be in YYYY-MM-DD format');
      } else {
        const date = new Date(dateOfBirth);
        if (isNaN(date.getTime())) {
          errors.push('Invalid date of birth');
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', '), errors });
    }

    const updatedUser = db.update(users)
      .set({
        name: name.trim(),
        dateOfBirth: dateOfBirth.trim(),
        location: location.trim(),
        occupation: occupation.trim(),
        gender: gender.trim(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning()
      .get();

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { passwordHash: _ph, ...userWithoutPassword } = updatedUser;

    res.json({ message: 'Onboarding data saved', user: userWithoutPassword });
  } catch (error) {
    console.error('Save onboarding error:', error);
    res.status(500).json({ error: 'Failed to save onboarding data' });
  }
});
