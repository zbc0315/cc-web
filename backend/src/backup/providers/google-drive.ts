// backend/src/backup/providers/google-drive.ts

import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CloudProvider, ProviderConfig, ProviderTokens, RemoteFile } from '../types';

export class GoogleDriveProvider implements CloudProvider {
  config: ProviderConfig;
  private oauth2Client: OAuth2Client;
  private folderIdCache: Map<string, string> = new Map();

  constructor(config: ProviderConfig) {
    this.config = config;
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret
    );

    if (config.tokens) {
      this.oauth2Client.setCredentials({
        access_token: config.tokens.access_token,
        refresh_token: config.tokens.refresh_token,
        expiry_date: new Date(config.tokens.expiry).getTime(),
      });
    }
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      redirectUri
    );
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      ...(state ? { state } : {}),
    });
  }

  async handleCallback(code: string, redirectUri: string): Promise<ProviderTokens> {
    const client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      redirectUri
    );
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Missing tokens in OAuth2 callback response');
    }
    const providerTokens: ProviderTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    this.oauth2Client.setCredentials({
      access_token: providerTokens.access_token,
      refresh_token: providerTokens.refresh_token,
      expiry_date: new Date(providerTokens.expiry).getTime(),
    });
    this.config.tokens = providerTokens;
    return providerTokens;
  }

  async refreshToken(): Promise<ProviderTokens> {
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error('Failed to refresh access token');
    }
    const providerTokens: ProviderTokens = {
      access_token: credentials.access_token,
      refresh_token:
        credentials.refresh_token ??
        this.config.tokens?.refresh_token ??
        '',
      expiry: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    this.oauth2Client.setCredentials({
      access_token: providerTokens.access_token,
      refresh_token: providerTokens.refresh_token,
      expiry_date: new Date(providerTokens.expiry).getTime(),
    });
    this.config.tokens = providerTokens;
    return providerTokens;
  }

  isAuthorized(): boolean {
    return !!(this.config.tokens?.access_token && this.config.tokens?.refresh_token);
  }

  async ensureAuth(): Promise<void> {
    if (!this.isAuthorized()) {
      throw new Error('Google Drive provider is not authorized');
    }
    const tokens = this.config.tokens!;
    const expiryMs = new Date(tokens.expiry).getTime();
    const nowMs = Date.now();
    // Refresh if within 60 seconds of expiry
    if (expiryMs - nowMs < 60 * 1000) {
      await this.refreshToken();
    }
  }

  private drive() {
    return google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Walk path segments and return the Drive folder ID, creating any missing folders.
   * Empty path or '/' returns 'root'.
   */
  private async getOrCreateFolder(folderPath: string): Promise<string> {
    const normalized = folderPath.replace(/^\/+|\/+$/g, '');
    if (!normalized) return 'root';

    if (this.folderIdCache.has(normalized)) {
      return this.folderIdCache.get(normalized)!;
    }

    const segments = normalized.split('/');
    let parentId = 'root';

    for (let i = 0; i < segments.length; i++) {
      const partialPath = segments.slice(0, i + 1).join('/');
      if (this.folderIdCache.has(partialPath)) {
        parentId = this.folderIdCache.get(partialPath)!;
        continue;
      }

      const segment = segments[i];
      const drive = this.drive();

      // Search for existing folder
      const res = await drive.files.list({
        q: `name = '${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id)',
        pageSize: 1,
      });

      let folderId: string;
      if (res.data.files && res.data.files.length > 0) {
        folderId = res.data.files[0].id!;
      } else {
        // Create the folder
        const created = await drive.files.create({
          requestBody: {
            name: segment,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          },
          fields: 'id',
        });
        folderId = created.data.id!;
      }

      this.folderIdCache.set(partialPath, folderId);
      parentId = folderId;
    }

    return parentId;
  }

  /**
   * Find the Drive file ID for a given remote path.
   * Returns null if not found.
   */
  private async findFileId(remotePath: string): Promise<string | null> {
    const normalized = remotePath.replace(/^\/+/, '');
    const lastSlash = normalized.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

    let parentId: string;
    try {
      parentId = await this.getOrCreateFolder(parentPath);
    } catch {
      return null;
    }

    const drive = this.drive();
    const res = await drive.files.list({
      q: `name = '${fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id!;
    }
    return null;
  }

  async listFiles(remotePath: string): Promise<RemoteFile[]> {
    await this.ensureAuth();

    const folderId = await this.getOrCreateFolder(remotePath);
    const drive = this.drive();
    const results: RemoteFile[] = [];
    let pageToken: string | undefined;

    const normalizedBase = remotePath.replace(/^\/+|\/+$/g, '');

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of res.data.files ?? []) {
        const isDirectory = file.mimeType === 'application/vnd.google-apps.folder';
        const filePath = normalizedBase ? `${normalizedBase}/${file.name!}` : file.name!;
        results.push({
          name: file.name!,
          path: filePath,
          isDirectory,
          size: isDirectory ? 0 : parseInt(file.size ?? '0', 10),
          modifiedTime: file.modifiedTime ?? new Date().toISOString(),
        });
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return results;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.ensureAuth();

    const normalized = remotePath.replace(/^\/+/, '');
    const lastSlash = normalized.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

    const parentId = await this.getOrCreateFolder(parentPath);
    const drive = this.drive();
    const fileStream = fs.createReadStream(localPath);

    // Check if file already exists
    const existingId = await this.findFileId(remotePath);

    if (existingId) {
      // Update existing file
      await drive.files.update({
        fileId: existingId,
        requestBody: {},
        media: {
          body: fileStream,
        },
        fields: 'id',
      });
    } else {
      // Create new file
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentId],
        },
        media: {
          body: fileStream,
        },
        fields: 'id',
      });
    }

  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.ensureAuth();

    const fileId = await this.findFileId(remotePath);
    if (!fileId) {
      throw new Error(`File not found on Google Drive: ${remotePath}`);
    }

    const drive = this.drive();
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise<void>((resolve, reject) => {
      const dest = fs.createWriteStream(localPath);
      (res.data as NodeJS.ReadableStream)
        .on('error', reject)
        .pipe(dest)
        .on('error', reject)
        .on('finish', resolve);
    });
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureAuth();

    const fileId = await this.findFileId(remotePath);
    if (!fileId) {
      // Already gone — treat as success
      return;
    }

    const drive = this.drive();
    await drive.files.delete({ fileId });

    // Invalidate cache entries that include this path
    const normalized = remotePath.replace(/^\/+|\/+$/g, '');
    for (const key of this.folderIdCache.keys()) {
      if (key === normalized || key.startsWith(normalized + '/')) {
        this.folderIdCache.delete(key);
      }
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.ensureAuth();
    await this.getOrCreateFolder(remotePath);
  }
}
