import { request } from 'node:http';

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * HTTP client that connects to a UDS (Unix Domain Socket) server
 */
export class UdsHttpClient {
  constructor(private socketPath: string) {}

  async get<T = unknown>(path: string): Promise<HttpResponse<T>> {
    return this.fetch('GET', path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<HttpResponse<T>> {
    return this.fetch('POST', path, body);
  }

  private fetch<T = unknown>(method: string, path: string, body?: unknown): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({
                status: res.statusCode || 500,
                data: parsed as T,
              });
            } catch (err) {
              reject(new Error(`Failed to parse response: ${err}`));
            }
          });
        }
      );

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}
