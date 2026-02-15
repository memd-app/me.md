import { Router } from 'express';
import { db } from '../config/database.js';
import { users } from '../models/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const authRouter = Router();

// POST /api/auth/register - Register a new user (dev mode: no Firebase verification)
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, name, dateOfBirth, location, occupation, gender } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    // Check if user already exists
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const userId = uuidv4();
    // In development mode, use a generated firebase_uid
    const firebaseUid = `dev_${uuidv4()}`;

    const newUser = db.insert(users).values({
      id: userId,
      firebaseUid,
      email,
      name: name || 'Anonymous',
      dateOfBirth: dateOfBirth || '2000-01-01',
      location: location || 'Unknown',
      occupation: occupation || 'Unknown',
      gender: gender || 'unspecified',
    }).returning().get();

    res.status(201).json({
      message: 'User registered successfully',
      user: newUser,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/auth/login - Login (dev mode: simple email lookup)
authRouter.post('/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      user,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// GET /api/auth/me - Get current user (dev mode: via query param or header)
authRouter.get('/me', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// DELETE /api/auth/account - Delete account
authRouter.delete('/account', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    db.delete(users).where(eq(users.id, userId)).run();

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});
