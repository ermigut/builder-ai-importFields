// Этот файл должен импортироваться ПЕРВЫМ во всех модулях, использующих переменные окружения
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Экспортируем переменные окружения для удобства
export const config = {
  PORT: process.env.PORT || 4000,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};
