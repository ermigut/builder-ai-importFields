// Этот файл должен импортироваться ПЕРВЫМ во всех модулях, использующих переменные окружения
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Экспортируем переменные окружения для удобства
export const config = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret',
  JWT_EXPIRES_IN: '7d',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // УСТАРЕВШИЕ: больше не используются, оставлены для совместимости
  EXTERNAL_API_URL: process.env.EXTERNAL_API_URL,
  EXTERNAL_API_JWT: process.env.EXTERNAL_API_JWT,
};
