export class VsqiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 502,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'VsqiError';
  }
}

function errorField(error: unknown, key: 'name' | 'message' | 'code'): string | undefined {
  if (typeof error !== 'object' || error === null || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function getErrorDetails(error: unknown) {
  const cause = typeof error === 'object' && error !== null && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  return {
    errorName: errorField(error, 'name'),
    errorMessage: errorField(error, 'message') ?? String(error),
    errorCode: errorField(error, 'code'),
    causeName: errorField(cause, 'name'),
    causeMessage: errorField(cause, 'message'),
    causeCode: errorField(cause, 'code')
  };
}

export function classifyUpstreamFailure(error: unknown): string {
  const errors: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth++) {
    errors.push(current);
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }

  const codes = errors.map(item => errorField(item, 'code')?.toUpperCase() ?? '');
  const names = errors.map(item => errorField(item, 'name')?.toLowerCase() ?? '');
  const messages = errors.map(item => errorField(item, 'message')?.toLowerCase() ?? '');

  if (codes.some(code => code === 'ENOTFOUND' || code === 'EAI_AGAIN')) return 'DNS_RESOLUTION_FAILURE';
  if (codes.includes('ECONNRESET')) return 'ECONNRESET';
  if (codes.includes('ECONNREFUSED')) return 'ECONNREFUSED';
  if (codes.includes('ETIMEDOUT') || names.includes('aborterror')) return 'ETIMEDOUT';
  if (codes.some(code => code.includes('CERT') || code.includes('VERIFY'))
      || messages.some(message => /certificate|cert|unable to verify|self.signed/.test(message))) {
    return 'TLS_CERTIFICATE_VALIDATION_FAILURE';
  }
  if (codes.some(code => code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL'))
      || messages.some(message => /tls|ssl|handshake/.test(message))) return 'TLS_HANDSHAKE_FAILURE';
  if (codes.some(code => code.startsWith('E')) || names.includes('typeerror')) return 'NETWORK_ERROR';
  return 'OTHER';
}
