// backend/src/backup/providers/onedrive.ts

import * as fs from 'fs';
import * as path from 'path';
import { Client } from '@microsoft/microsoft-graph-client';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

const AUTHORITY = 'https://login.microsoftonline.com/consumers';
const TOKEN_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/token`;
const SCOPES = 'Files.ReadWrite offline_access';

// 4 MB threshold for simple upload vs upload session
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
// 10 MB chunk size for large file upload sessions
const CHUNK_SIZE = 10 * 1024 * 1024;

export class OneDriveProvider implements CloudProvider {
  config: ProviderConfig;
  private graphClient: Client | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
    if (config.tokens) {
      this.initGraphClient(config.tokens.access_token);
    }
  }

  private initGraphClient(accessToken: string): void {
    this.graphClient = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      response_mode: 'query',
      ...(state ? { state } : {}),
    });
    return `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OneDrive token exchange failed: ${res.status} ${text}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    if (!data.access_token || !data.refresh_token) {
      throw new Error('Missing tokens in OneDrive OAuth2 callback response');
    }

    const providerTokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    this.config.tokens = providerTokens;
    this.initGraphClient(providerTokens.access_token);
    return providerTokens;
  }

  async refreshToken(): Promise<ProviderTokens> {
    if (!this.config.tokens?.refresh_token) {
      throw new Error('No refresh token available for OneDrive provider');
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.tokens.refresh_token,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OneDrive token refresh failed: ${res.status} ${text}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!data.access_token) {
      throw new Error('Failed to refresh OneDrive access token');
    }

    const providerTokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.config.tokens.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    this.config.tokens = providerTokens;
    this.initGraphClient(providerTokens.access_token);
    return providerTokens;
  }

  isAuthorized(): boolean {
    return !!(this.config.tokens?.access_token && this.config.tokens?.refresh_token);
  }

  async ensureAuth(): Promise<void> {
    if (!this.isAuthorized()) {
      throw new Error('OneDrive provider is not authorized');
    }
    const tokens = this.config.tokens!;
    const expiryMs = new Date(tokens.expiry).getTime();
    const nowMs = Date.now();
    // Refresh if within 60 seconds of expiry
    if (expiryMs - nowMs < 60 * 1000) {
      await this.refreshToken();
    }
  }

  private client(): Client {
    if (!this.graphClient) {
      throw new Error('OneDrive Graph client is not initialized');
    }
    return this.graphClient;
  }

  /**
   * Returns the Graph API path for a given remote path.
   * e.g. "backup/myproject" → "/me/drive/root:/backup/myproject:"
   * Empty or root path → "/me/drive/root"
   */
  private itemPath(remotePath: string): string {
    const normalized = remotePath.replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      return '/me/drive/root';
    }
    return `/me/drive/root:/${normalized}:`;
  }

  /**
   * Returns the children endpoint for a given remote path.
   */
  private childrenPath(remotePath: string): string {
    const normalized = remotePath.replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      return '/me/drive/root/children';
    }
    return `/me/drive/root:/${normalized}:/children`;
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();

    const results: RemoteFile[] = [];
    const normalizedBase = remotePath.replace(/^\/+|\/+$/g, '');
    let nextLink: string | undefined = this.childrenPath(remotePath);

    while (nextLink) {
      const res = await this.client()
        .api(nextLink)
        .select('name,folder,size,lastModifiedDateTime')
        .top(1000)
        .get() as {
          value: Array<{
            name: string;
            folder?: object;
            size: number;
            lastModifiedDateTime: string;
          }>;
          '@odata.nextLink'?: string;
        };

      for (const item of res.value ?? []) {
        const isDirectory = !!item.folder;
        const filePath = normalizedBase ? `${normalizedBase}/${item.name}` : item.name;
        results.push({
          name: item.name,
          path: filePath,
          isDirectory,
          size: isDirectory ? 0 : (item.size ?? 0),
          modifiedTime: item.lastModifiedDateTime ?? new Date().toISOString(),
        });
      }

      nextLink = res['@odata.nextLink'];
    }

    return results;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();

    const stat = fs.statSync(localPath);
    const fileSize = stat.size;

    if (fileSize < SIMPLE_UPLOAD_MAX) {
      // Simple upload (PUT with body)
      const fileBuffer = fs.readFileSync(localPath);
      await this.client()
        .api(`${this.itemPath(remotePath)}/content`)
        .put(fileBuffer);
    } else {
      // Large file: use upload session
      const session = await this.client()
        .api(`${this.itemPath(remotePath)}/createUploadSession`)
        .post({
          item: {
            '@microsoft.graph.conflictBehavior': 'replace',
          },
        }) as { uploadUrl: string };

      const uploadUrl = session.uploadUrl;
      const fd = fs.openSync(localPath, 'r');

      try {
        let offset = 0;
        while (offset < fileSize) {
          const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
          const chunk = Buffer.alloc(chunkSize);
          fs.readSync(fd, chunk, 0, chunkSize, offset);

          const rangeEnd = offset + chunkSize - 1;
          const res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${offset}-${rangeEnd}/${fileSize}`,
              'Content-Type': 'application/octet-stream',
            },
            body: chunk,
          });

          if (!res.ok && res.status !== 202) {
            const text = await res.text();
            throw new Error(`OneDrive chunk upload failed at offset ${offset}: ${res.status} ${text}`);
          }

          offset += chunkSize;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();

    const normalized = remotePath.replace(/^\/+|\/+$/g, '');
    if (!normalized) return;

    const segments = normalized.split('/');

    for (let i = 0; i < segments.length; i++) {
      const parentPath = segments.slice(0, i).join('/');
      const folderName = segments[i];

      const parentEndpoint = parentPath
        ? `/me/drive/root:/${parentPath}:/children`
        : '/me/drive/root/children';

      try {
        await this.client()
          .api(parentEndpoint)
          .post({
            name: folderName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          });
      } catch (err: unknown) {
        // 409 Conflict means folder already exists — that's fine
        const graphErr = err as { statusCode?: number; code?: string };
        if (graphErr.statusCode !== 409 && graphErr.code !== 'nameAlreadyExists') {
          throw err;
        }
      }
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();

    // Get a redirect URL to the file content
    const downloadUrl = await this.client()
      .api(`${this.itemPath(remotePath)}/content`)
      .getStream() as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      const dest = fs.createWriteStream(localPath);
      downloadUrl
        .on('error', reject)
        .pipe(dest)
        .on('error', reject)
        .on('finish', resolve);
    });
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();

    try {
      await this.client()
        .api(this.itemPath(remotePath))
        .delete();
    } catch (err: unknown) {
      // 404 means already gone — treat as success
      const graphErr = err as { statusCode?: number };
      if (graphErr.statusCode !== 404) {
        throw err;
      }
    }
  }
}
