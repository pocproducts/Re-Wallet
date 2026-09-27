/**
 * Every error that reaches a client has the same shape: { error, message, code }.
 * `error` is a stable machine token; `message` is for humans and may be shown.
 */
export class AppError extends Error {
  constructor(
    readonly error: string,
    override readonly message: string,
    readonly code: number,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (error: string, message: string) => new AppError(error, message, 400, 400);

export const unauthorized = (message = 'Sesión requerida.') =>
  new AppError('unauthorized', message, 401, 401);

export const forbidden = (message = 'No autorizado.') => new AppError('forbidden', message, 403, 403);

export const notFound = (message = 'Recurso no encontrado.') =>
  new AppError('not_found', message, 404, 404);

export const insufficientFunds = (message = 'Saldo insuficiente') =>
  new AppError('insufficient_funds', message, 402, 402);

export const conflict = (error: string, message: string) => new AppError(error, message, 409, 409);

export const rateLimited = (message = 'Demasiadas solicitudes.') =>
  new AppError('rate_limited', message, 429, 429);

export const internal = (message = 'Error interno.') => new AppError('internal', message, 500, 500);

export const notImplemented = (what: string) =>
  new AppError('not_implemented', `${what} todavía no está implementado.`, 501, 501);
