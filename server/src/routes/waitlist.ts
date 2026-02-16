import { Router } from 'express';
import { sqlite } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

export const waitlistRouter = Router();

// Basic email validation
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 320;
}

// POST /api/waitlist - Submit email for waitlist signup (public, no auth required)
waitlistRouter.post('/', (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Check if email already exists
    const existing = sqlite
      .prepare('SELECT id FROM waitlist_signups WHERE email = ?')
      .get(trimmedEmail) as { id: string } | undefined;

    if (existing) {
      // Gracefully handle duplicate - return success to avoid revealing if email is registered
      return res.status(200).json({
        message: "You're already on the waitlist! We'll be in touch soon.",
        alreadyExists: true,
      });
    }

    // Insert new signup
    const id = uuidv4();
    sqlite
      .prepare('INSERT INTO waitlist_signups (id, email) VALUES (?, ?)')
      .run(id, trimmedEmail);

    console.log(`[me.md] New waitlist signup: ${trimmedEmail}`);

    return res.status(201).json({
      message: "You're on the list! We'll be in touch soon.",
      alreadyExists: false,
    });
  } catch (err) {
    console.error('[me.md] Waitlist signup error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
