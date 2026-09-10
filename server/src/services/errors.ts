export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = 'Not allowed') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
