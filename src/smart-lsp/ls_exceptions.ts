export class SmartLSPException extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SmartLSPException';
    this.cause = cause;
  }

  isLanguageServerTerminated(): boolean {
    if (!this.cause) {
      return false;
    }
    return (this.cause as Error).name === 'LanguageServerTerminatedException';
  }
}
