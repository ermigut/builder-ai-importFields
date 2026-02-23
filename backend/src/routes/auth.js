// Импортируем config ПЕРВЫМ для загрузки переменных окружения
import '../config.js';

import express from 'express';
import jwt from 'jsonwebtoken';
import { createUser, validateUser } from '../models/userStore.js';
import { config } from '../config.js';

const router = express.Router();

const JWT_SECRET = config.JWT_SECRET;
const JWT_EXPIRES_IN = config.JWT_EXPIRES_IN;

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await createUser({ username, password });
    const token = generateToken(user);

    return res.status(201).json({ user, token });
  } catch (err) {
    if (err.message === 'User already exists') {
      return res.status(409).json({ error: 'User already exists' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await validateUser({ username, password });
    if (!user) {
      console.log(`Login failed for username: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    console.log(`Login successful for username: ${username}`);
    return res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

