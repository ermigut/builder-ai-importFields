/**
 * Middleware для логирования HTTP запросов
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Логируем запрос
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    query: req.query,
    body: req.method !== 'GET' ? (req.path.includes('/auth') ? '[скрыто]' : req.body) : undefined,
  });

  // Перехватываем ответ для логирования
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    return originalSend.call(this, data);
  };

  next();
};

/**
 * Логирование операций с ИИ
 */
export const logAiOperation = (operation, details) => {
  console.log(`[AI] ${new Date().toISOString()} - ${operation}`, details);
};

/**
 * Логирование операций с Albato API
 */
export const logAlbatoApiOperation = (operation, details) => {
  console.log(`[Albato API] ${new Date().toISOString()} - ${operation}`, {
    ...details,
    // Не логируем чувствительные данные
    url: details.url ? '[скрыто]' : undefined,
  });
};
