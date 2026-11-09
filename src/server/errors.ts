/**
 * An error whose message is written for the person using the app. Anything
 * else (provider errors, stack details) stays in logs and Sentry and is shown
 * as a generic line.
 */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export function errorMessage(e: unknown) {
  return e instanceof UserError ? e.message : "Something went wrong on our side. Try again in a moment.";
}

export function errorStatus(e: unknown) {
  return e instanceof UserError ? e.status : 500;
}
