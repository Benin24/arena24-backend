const errorHandler = (err, req, res, next) => {
  console.error(`[Arena24 Error] ${err.message}`, {
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
  });

  // Supabase errors
  if (err.code && err.code.startsWith('P')) {
    return res.status(400).json({ success: false, message: 'Database error. Please try again.' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }

  // Validation errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.isOperational ? err.message : 'Something went wrong. Please try again.';

  res.status(statusCode).json({ success: false, message });
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = errorHandler;
module.exports.AppError = AppError;
