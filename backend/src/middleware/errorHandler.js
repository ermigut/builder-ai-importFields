/**
 * Централизованный обработчик ошибок для Express
 */
export const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${new Date().toISOString()}`, {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Если ответ уже отправлен, передаём ошибку дальше
  if (res.headersSent) {
    return next(err);
  }

  // Определяем статус код
  const statusCode = err.statusCode || err.status || 500;

  // Формируем ответ
  res.status(statusCode).json({
    error: err.message || 'Внутренняя ошибка сервера',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Middleware для обработки 404 ошибок
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    error: `Маршрут ${req.method} ${req.path} не найден`,
  });
};
