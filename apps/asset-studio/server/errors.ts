// An error with a message the page can show as it is.
export class StudioError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500 | 502,
    message: string,
  ) {
    super(message);
  }
}
