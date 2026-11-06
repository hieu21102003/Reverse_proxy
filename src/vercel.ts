import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';

const app = await createApp();
await app.ready();

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  app.server.emit('request', request, response);
}
