// The subset of Fastify's pino logger the Hub's services use, so they can run without a server in tests.

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
