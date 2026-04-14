// Импортируем config ПЕРВЫМ - он загружает переменные окружения
import './config.js';

import express from 'express';
import cors from 'cors';
import aiGenerateRouter from './routes/aiGenerate.js';
import albatoApiRouter from './routes/externalApi.js';
import chatRouter from './routes/chatSession.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { config } from './config.js';
import { initVectorStore } from './services/vectorStore.js';

const app = express();
const PORT = config.PORT;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Логирование запросов
app.use(requestLogger);

// Health-check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// AI Generate routes
app.use('/ai', aiGenerateRouter);

// Albato API routes
app.use('/albato', albatoApiRouter);

// Chat session routes
app.use('/chat', chatRouter);

// Обработка 404
app.use(notFoundHandler);

// Централизованная обработка ошибок (должен быть последним)
app.use(errorHandler);

// Инициализация векторного хранилища и запуск сервера
initVectorStore()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.warn('VectorStore init failed, starting without RAG:', err.message);
    app.listen(PORT, () => {
      console.log(`Backend server is running on port ${PORT} (without RAG)`);
    });
  });

