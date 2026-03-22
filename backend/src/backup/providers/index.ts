import { CloudProvider, ProviderConfig } from '../types';
import { GoogleDriveProvider } from './google-drive';
import { OneDriveProvider } from './onedrive';
import { DropboxProvider } from './dropbox';

export function createProvider(config: ProviderConfig): CloudProvider {
  switch (config.type) {
    case 'google-drive':
      return new GoogleDriveProvider(config);
    case 'onedrive':
      return new OneDriveProvider(config);
    case 'dropbox':
      return new DropboxProvider(config);
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`);
  }
}
