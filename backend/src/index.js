// Импортируем config ПЕРВЫМ - он загружает переменные окружения
import './config.js';

import express from 'express';
import cors from 'cors';
import aiGenerateRouter from './routes/aiGenerate.js';
import albatoApiRouter from './routes/externalApi.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { config } from './config.js';

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

// Обработка 404
app.use(notFoundHandler);

// Централизованная обработка ошибок (должен быть последним)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});

