// backend/src/backup/providers/dropbox.ts

import * as fs from 'fs';
import * as path from 'path';
import { Dropbox } from 'dropbox';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

const TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';

// 150 MB threshold: above this use chunked upload session
const SIMPLE_UPLOAD_MAX = 150 * 1024 * 1024;
// 8 MB chunk size for upload sessions
const CHUNK_SIZE = 8 * 1024 * 1024;

export class DropboxProvider implements CloudProvider {
  config: ProviderConfig;
  private dbx: Dropbox | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
    if (config.tokens) {
      this.initClient(config.tokens.access_token);
    }
  }

  private initClient(accessToken: string): void {
    this.dbx = new Dropbox({ accessToken });
  }

  private client(): Dropbox {
    if (!this.dbx) {
      throw new Error('Dropbox client is not initialized');
    }
    return this.dbx;
  }

  /**
   * Normalize a path to Dropbox format:
   * - Root is empty string ''
   * - All other paths start with '/' and have no trailing slash
   */
  private normPath(remotePath: string): string {
    // Strip leading/trailing slashes then re-add leading slash if non-empty
    const stripped = remotePath.replace(/^\/+|\/+$/g, '');
    if (!stripped) return '';
    return '/' + stripped;
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      token_access_type: 'offline',
      ...(state ? { state } : {}),
    });
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox token exchange failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    if (!data.access_token || !data.refresh_token) {
      throw new Error('Missing tokens in Dropbox OAuth2 callback response');
    }

    const providerTokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    this.config.tokens = providerTokens;
    this.initClient(providerTokens.access_token);
    return providerTokens;
  }

  async refreshToken(): Promise<ProviderTokens> {
    if (!this.config.tokens?.refresh_token) {
      throw new Error('No refresh token available for Dropbox provider');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.tokens.refresh_token,
    });

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox token refresh failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!data.access_token) {
      throw new Error('Failed to refresh Dropbox access token');
    }

    const providerTokens: ProviderTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.config.tokens.refresh_token,
      expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    this.config.tokens = providerTokens;
    this.initClient(providerTokens.access_token);
    return providerTokens;
  }

  isAuthorized(): boolean {
    return !!(this.config.tokens?.access_token && this.config.tokens?.refresh_token);
  }

  async ensureAuth(): Promise<void> {
    if (!this.isAuthorized()) {
      throw new Error('Dropbox provider is not authorized');
    }
    const tokens = this.config.tokens!;
    const expiryMs = new Date(tokens.expiry).getTime();
    const nowMs = Date.now();
    // Refresh if within 60 seconds of expiry
    if (expiryMs - nowMs < 60 * 1000) {
      await this.refreshToken();
    }
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();

    const dbxPath = this.normPath(remotePath);
    const results: RemoteFile[] = [];

    let response = await this.client().filesListFolder({ path: dbxPath });

    while (true) {
      for (const entry of response.result.entries) {
        const isDirectory = entry['.tag'] === 'folder';
        const entryPath = entry.path_display ?? entry.path_lower ?? entry.name;
        // Return path relative to remotePath base (strip leading slash)
        const normalizedBase = remotePath.replace(/^\/+|\/+$/g, '');
        const relPath = normalizedBase
          ? `${normalizedBase}/${entry.name}`
          : entry.name;

        results.push({
          name: entry.name,
          path: relPath,
          isDirectory,
          size: isDirectory ? 0 : ((entry as { size?: number }).size ?? 0),
          modifiedTime: isDirectory
            ? new Date().toISOString()
            : ((entry as { server_modified?: string }).server_modified ?? new Date().toISOString()),
        });
      }

      if (!response.result.has_more) break;

      response = await this.client().filesListFolderContinue({
        cursor: response.result.cursor,
      });
    }

    return results;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();

    const dbxPath = this.normPath(remotePath);
    const stat = fs.statSync(localPath);
    const fileSize = stat.size;

    if (fileSize < SIMPLE_UPLOAD_MAX) {
      // Simple upload
      const fileContent = fs.readFileSync(localPath);
      await this.client().filesUpload({
        path: dbxPath,
        mode: { '.tag': 'overwrite' },
        contents: fileContent,
      });
    } else {
      // Chunked upload session
      const fd = fs.openSync(localPath, 'r');
      try {
        // Start upload session with first chunk
        let offset = 0;
        const firstChunkSize = Math.min(CHUNK_SIZE, fileSize);
        const firstChunk = Buffer.alloc(firstChunkSize);
        fs.readSync(fd, firstChunk, 0, firstChunkSize, 0);
        offset += firstChunkSize;

        const startRes = await this.client().filesUploadSessionStart({
          close: false,
          contents: firstChunk,
        });
        const sessionId = startRes.result.session_id;

        // Append remaining chunks
        while (offset < fileSize) {
          const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
          const chunk = Buffer.alloc(chunkSize);
          fs.readSync(fd, chunk, 0, chunkSize, offset);

          const isLast = offset + chunkSize >= fileSize;

          if (isLast) {
            // Finish the session
            await this.client().filesUploadSessionFinish({
              cursor: { session_id: sessionId, offset },
              commit: {
                path: dbxPath,
                mode: { '.tag': 'overwrite' },
              },
              contents: chunk,
            });
          } else {
            await this.client().filesUploadSessionAppendV2({
              cursor: { session_id: sessionId, offset },
              close: false,
              contents: chunk,
            });
          }

          offset += chunkSize;
        }

        // Edge case: file exactly one chunk — finish with empty content
        if (fileSize === firstChunkSize) {
          await this.client().filesUploadSessionFinish({
            cursor: { session_id: sessionId, offset },
            commit: {
              path: dbxPath,
              mode: { '.tag': 'overwrite' },
            },
            contents: Buffer.alloc(0),
          });
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();

    const dbxPath = this.normPath(remotePath);
    try {
      await this.client().filesDeleteV2({ path: dbxPath });
    } catch (err: unknown) {
      // Ignore path_lookup errors (file not found) — treat as success
      const errObj = err as { error?: { error_summary?: string } };
      const summary = errObj?.error?.error_summary ?? '';
      if (!summary.startsWith('path_lookup/')) {
        throw err;
      }
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();

    const dbxPath = this.normPath(remotePath);
    if (!dbxPath) return; // root always exists

    try {
      await this.client().filesCreateFolderV2({ path: dbxPath });
    } catch (err: unknown) {
      // Ignore path/conflict errors (folder already exists)
      const errObj = err as { error?: { error_summary?: string } };
      const summary = errObj?.error?.error_summary ?? '';
      if (!summary.startsWith('path/conflict')) {
        throw err;
      }
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();

    const dbxPath = this.normPath(remotePath);
    const res = await this.client().filesDownload({ path: dbxPath });

    // The SDK returns the binary content as `fileBinary` in the result
    const fileBinary = (res.result as unknown as { fileBinary: Buffer }).fileBinary;
    if (!fileBinary) {
      throw new Error(`Dropbox filesDownload returned no fileBinary for: ${remotePath}`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(localPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(localPath, fileBinary);
  }
}
