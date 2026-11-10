import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface S3Config {
  endpoint: string; // e.g. https://s3.eu-west-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
}

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();

/** Minimal AWS Signature V4 PUT; works with S3, Backblaze B2, Cloudflare R2, MinIO, Wasabi. */
export function createS3Uploader(cfg: S3Config, fetchImpl: typeof fetch = fetch) {
  const host = new URL(cfg.endpoint).host;
  return async function upload(localPath: string, key: string): Promise<string> {
    const body = readFileSync(localPath);
    const fullKey = `${cfg.prefix.replace(/^\/+|\/+$/g, '')}${cfg.prefix ? '/' : ''}${key}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalUri = `/${cfg.bucket}/${fullKey.split('/').map(encodeURIComponent).join('/')}`;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join('');
    const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, date), cfg.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const res = await fetchImpl(`${cfg.endpoint.replace(/\/$/, '')}${canonicalUri}`, {
      method: 'PUT',
      headers: { ...headers, authorization, 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`S3 upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return `${cfg.bucket}/${fullKey}`;
  };
}
