import { Router } from 'express';
import { db } from '../config/database.js';
import { users, passwordResetTokens } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export const authRouter = Router();

// Hash a password with a random salt
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Verify a password against a stored hash
function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const derivedKey = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, derivedKey);
}

// POST /api/auth/register - Register a new user (dev mode: no Firebase verification)
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, name, dateOfBirth, location, occupation, gender } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password requirements: 8+ chars, 1 number, 1 special char
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/\d/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least 1 number' });
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least 1 special character' });
    }

    // Check if user already exists
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const userId = uuidv4();
    // In development mode, use a generated firebase_uid
    const firebaseUid = `dev_${uuidv4()}`;

    // Hash the password before storing
    const passwordHash = hashPassword(password);

    const newUser = db.insert(users).values({
      id: userId,
      firebaseUid,
      email,
      passwordHash,
      name: name || 'Anonymous',
      dateOfBirth: dateOfBirth || '2000-01-01',
      location: location || 'Unknown',
      occupation: occupation || 'Unknown',
      gender: gender || 'unspecified',
    }).returning().get();

    // Don't return password_hash in the response
    const { passwordHash: _ph, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User registered successfully',
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/auth/login - Login with email and password
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      return res.status(401).json({ error: 'No account found with this email address. Please check your email or sign up for a new account.' });
    }

    // Verify password - if user has no password_hash (legacy user), allow login with any password
    if (user.passwordHash) {
      const isValid = verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Incorrect password. Please try again or reset your password.' });
      }
    }

    // Don't return password_hash in the response
    const { passwordHash: _ph, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
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

    // Don't return password_hash in the response
    const { passwordHash: _ph, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/google - Sign in with Google (Firebase Auth)
authRouter.post('/google', async (req, res) => {
  try {
    const { idToken, email, name, firebaseUid } = req.body;

    if (!email || !firebaseUid) {
      return res.status(400).json({ error: 'Email and Firebase UID are required' });
    }

    // In production, verify the idToken with Firebase Admin SDK
    // For now, we trust the client-side Firebase authentication
    // and use the firebaseUid + email to create/find the user
    let verifiedUid = firebaseUid;
    let verifiedEmail = email;
    let verifiedName = name || email.split('@')[0] || 'User';

    // Try to verify with Firebase Admin if configured
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (projectId && projectId !== 'your-firebase-project-id' && idToken) {
      try {
        // Dynamic import of firebase-admin to avoid issues when not configured
        const admin = await import('firebase-admin');

        // Initialize if not already initialized
        if (admin.default.apps.length === 0) {
          const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
          admin.default.initializeApp({
            credential: admin.default.credential.cert({
              projectId,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey,
            }),
          });
        }

        const decodedToken = await admin.default.auth().verifyIdToken(idToken);
        verifiedUid = decodedToken.uid;
        verifiedEmail = decodedToken.email || email;
        verifiedName = decodedToken.name || name || 'User';
        console.log('[me.md:auth] Firebase token verified for:', verifiedEmail);
      } catch (firebaseError) {
        console.warn('[me.md:auth] Firebase Admin verification failed, using client data:',
          firebaseError instanceof Error ? firebaseError.message : 'unknown error');
        // Fall back to trusting client data (dev mode)
      }
    } else {
      console.log('[me.md:auth] Firebase Admin not configured, trusting client auth data');
    }

    // Check if user already exists by firebase_uid
    const existingByUid = db.select().from(users).where(eq(users.firebaseUid, verifiedUid)).get();
    if (existingByUid) {
      const { passwordHash: _ph, ...userWithoutPassword } = existingByUid;
      return res.json({
        message: 'Login successful',
        user: userWithoutPassword,
      });
    }

    // Check if user exists by email (might have registered with email/password first)
    const existingByEmail = db.select().from(users).where(eq(users.email, verifiedEmail)).get();
    if (existingByEmail) {
      // Link the Firebase UID to the existing account
      db.update(users)
        .set({ firebaseUid: verifiedUid })
        .where(eq(users.id, existingByEmail.id))
        .run();

      const updated = db.select().from(users).where(eq(users.id, existingByEmail.id)).get();
      if (updated) {
        const { passwordHash: _ph, ...userWithoutPassword } = updated;
        return res.json({
          message: 'Login successful',
          user: userWithoutPassword,
        });
      }
    }

    // Create a new user account for this Google sign-in
    const userId = uuidv4();
    const newUser = db.insert(users).values({
      id: userId,
      firebaseUid: verifiedUid,
      email: verifiedEmail,
      passwordHash: null,
      name: verifiedName,
      dateOfBirth: '2000-01-01',
      location: 'Unknown',
      occupation: 'Unknown',
      gender: 'unspecified',
    }).returning().get();

    const { passwordHash: _ph, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User created via Google Sign-In',
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
});

// POST /api/auth/verify-password - Verify user's password
authRouter.post('/verify-password', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Account does not have a password set (Google Sign-In account)' });
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ message: 'Password verified successfully', verified: true });
  } catch (error) {
    console.error('Verify password error:', error);
    res.status(500).json({ error: 'Failed to verify password' });
  }
});

// DELETE /api/auth/account - Delete account (requires password confirmation)
authRouter.delete('/account', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { password } = req.body || {};

    // Find the user first
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If user has a password, require password confirmation
    if (user.passwordHash) {
      if (!password) {
        return res.status(400).json({ error: 'Password confirmation is required to delete account' });
      }

      const isValid = verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
    }

    // Delete the user (cascades to all related data)
    db.delete(users).where(eq(users.id, userId)).run();

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});
