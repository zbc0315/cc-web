export interface Project {
  id: string;
  name: string;
  folderPath: string;
  permissionMode: 'limited' | 'unlimited';
  createdAt: string;
  status: 'running' | 'stopped' | 'restarting';
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}