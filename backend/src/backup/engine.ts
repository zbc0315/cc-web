// backend/src/backup/engine.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { minimatch } from 'minimatch';
import { v4 as uuidv4 } from 'uuid';
import { CloudProvider, BackupState, FileSnapshot, BackupHistoryEntry, ProviderConfig } from './types';
import { getBackupConfig, getBackupState, saveBackupState, saveBackupConfig, addBackupHistory } from './config';
import { createProvider } from './providers';
import { getProjects } from '../config';

export interface BackupProgress {
  projectId: string;
  projectName: string;
  providerId: string;
  providerLabel: string;
  status: 'scanning' | 'uploading' | 'deleting' | 'done' | 'error';
  filesUploaded: number;
  filesDeleted: number;
  filesTotal: number;
  error?: string;
}

export type ProgressCallback = (progress: BackupProgress) => void;

export function computeHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

export function shouldExclude(relativePath: string, patterns: string[]): boolean {
  const segments = relativePath.split('/');
  for (const pattern of patterns) {
    // Match full relative path
    if (minimatch(relativePath, pattern, { dot: true, matchBase: true })) {
      return true;
    }
    // Match each path segment individually
    for (const segment of segments) {
      if (minimatch(segment, pattern, { dot: true, matchBase: true })) {
        return true;
      }
    }
  }
  return false;
}

export function scanDirectory(
  dirPath: string,
  excludePatterns: string[],
  basePath?: string
): Map<string, { mtime: number; size: number }> {
  const result = new Map<string, { mtime: number; size: number }>();
  const base = basePath ?? dirPath;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (shouldExclude(relativePath, excludePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subResult = scanDirectory(fullPath, excludePatterns, base);
      for (const [relPath, info] of subResult) {
        result.set(relPath, info);
      }
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        result.set(relativePath, {
          mtime: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return result;
}

export async function runBackup(
  projectId: string,
  onProgress?: ProgressCallback
): Promise<BackupHistoryEntry[]> {
  const config = getBackupConfig();
  const authorizedProviders = config.providers.filter((p) => p.tokens);

  if (authorizedProviders.length === 0) {
    return [];
  }

  const projects = getProjects();
  const project = projects.find((p) => p.id === projectId && !p.archived);
  if (!project) {
    throw new Error(`Project ${projectId} not found or archived`);
  }

  if (!fs.existsSync(project.folderPath)) {
    throw new Error(`Project folder does not exist: ${project.folderPath}`);
  }

  const excludePatterns = config.excludePatterns ?? [];

  // Step 1: Scan local files
  const scanned = scanDirectory(project.folderPath, excludePatterns);

  // Step 2: Load previous backup state
  const prevState = getBackupState(project.folderPath);

  // Step 3: Determine which files need uploading (changed or new)
  const newFiles: Record<string, FileSnapshot> = {};
  const toUpload: string[] = []; // relative paths

  for (const [relPath, { mtime, size }] of scanned) {
    const prev = prevState.files[relPath];
    if (prev && prev.mtime === mtime && prev.size === size) {
      // Unchanged: keep previous snapshot
      newFiles[relPath] = prev;
    } else {
      // Changed or new: compute hash
      const fullPath = path.join(project.folderPath, relPath);
      let hash: string;
      try {
        hash = await computeHash(fullPath);
      } catch {
        // Unreadable file, skip
        continue;
      }

      if (prev && prev.hash === hash) {
        // Content unchanged, just update mtime/size
        newFiles[relPath] = { mtime, size, hash };
      } else {
        // Content changed: queue for upload
        newFiles[relPath] = { mtime, size, hash };
        toUpload.push(relPath);
      }
    }
  }

  // Step 4: Detect deletions (files in prev state no longer present locally)
  const toDelete: string[] = [];
  for (const relPath of Object.keys(prevState.files)) {
    if (!scanned.has(relPath)) {
      toDelete.push(relPath);
    }
  }

  const totalFiles = scanned.size;
  const startTime = new Date().toISOString();
  const results: BackupHistoryEntry[] = [];

  // Step 5: Run backup for each provider in parallel
  const providerResults = await Promise.all(
    authorizedProviders.map(async (providerConfig) => {
      const provider = createProvider(providerConfig);
      let filesUploaded = 0;
      let filesDeleted = 0;
      let entryStatus: 'success' | 'failed' | 'partial' = 'success';
      let errorMsg: string | undefined;

      const reportProgress = (
        status: BackupProgress['status'],
        uploaded = filesUploaded,
        deleted = filesDeleted
      ) => {
        onProgress?.({
          projectId,
          projectName: project.name,
          providerId: providerConfig.id,
          providerLabel: providerConfig.label,
          status,
          filesUploaded: uploaded,
          filesDeleted: deleted,
          filesTotal: totalFiles,
        });
      };

      try {
        await provider.ensureAuth();

        // Create base remote directory
        const baseRemotePath = `CCWeb/${project.name}`;
        await provider.mkdir(baseRemotePath);

        // Upload changed files
        reportProgress('uploading');
        for (const relPath of toUpload) {
          const localPath = path.join(project.folderPath, relPath);
          const remotePath = `${baseRemotePath}/${relPath}`;

          // Ensure parent directory exists
          const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
          if (remoteDir !== baseRemotePath) {
            await provider.mkdir(remoteDir);
          }

          try {
            await provider.uploadFile(localPath, remotePath);
            filesUploaded++;
            reportProgress('uploading');
          } catch (err) {
            // Continue on individual file error
            entryStatus = 'partial';
          }
        }

        // Delete orphaned remote files
        reportProgress('deleting', filesUploaded, filesDeleted);
        for (const relPath of toDelete) {
          const remotePath = `${baseRemotePath}/${relPath}`;
          try {
            await provider.deleteFile(remotePath);
            filesDeleted++;
            reportProgress('deleting', filesUploaded, filesDeleted);
          } catch {
            // Ignore delete errors (file may already be gone)
          }
        }

        reportProgress('done', filesUploaded, filesDeleted);
      } catch (err: any) {
        entryStatus = 'failed';
        errorMsg = err?.message ?? String(err);
        reportProgress('error', filesUploaded, filesDeleted);
      }

      const endTime = new Date().toISOString();
      const entry: BackupHistoryEntry = {
        id: uuidv4(),
        projectId,
        projectName: project.name,
        providerId: providerConfig.id,
        providerType: providerConfig.type,
        providerLabel: providerConfig.label,
        startTime,
        endTime,
        status: entryStatus,
        filesUploaded,
        filesDeleted,
        filesTotal: totalFiles,
        error: errorMsg,
      };

      return { entry, success: entryStatus !== 'failed' };
    })
  );

  // Step 6: If any provider succeeded, save new backup state
  const anySuccess = providerResults.some((r) => r.success);
  if (anySuccess) {
    const newState: BackupState = {
      lastBackupTime: new Date().toISOString(),
      files: newFiles,
    };
    saveBackupState(project.folderPath, newState);
  }

  // Step 7: Save history entries and collect results
  for (const { entry } of providerResults) {
    addBackupHistory(entry);
    results.push(entry);
  }

  return results;
}

export async function runBackupAll(onProgress?: ProgressCallback): Promise<BackupHistoryEntry[]> {
  const projects = getProjects().filter((p) => !p.archived);
  const allResults: BackupHistoryEntry[] = [];

  for (const project of projects) {
    try {
      const entries = await runBackup(project.id, onProgress);
      allResults.push(...entries);
    } catch {
      // Continue with other projects
    }
  }

  return allResults;
}
