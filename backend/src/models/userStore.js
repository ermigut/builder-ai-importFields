import bcrypt from 'bcryptjs';

// In-memory store for users (for MVP)
// In production, this should be replaced with a real database.
const users = [];

export async function createUser({ username, password }) {
  const existing = users.find((u) => u.username === username);
  if (existing) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: users.length + 1,
    username,
    passwordHash,
  };

  users.push(user);
  return { id: user.id, username: user.username };
}

export async function validateUser({ username, password }) {
  const user = users.find((u) => u.username === username);
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return { id: user.id, username: user.username };
}

