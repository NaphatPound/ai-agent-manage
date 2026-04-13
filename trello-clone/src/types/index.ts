export interface Workspace {
  id: string;
  name: string;
  description?: string;
  boardIds: string[];
  createdAt: string;
}

export interface Board {
  id: string;
  workspaceId: string;
  title: string;
  background: BoardBackground;
  listIds: string[];
  labels: Label[];
  members: Member[];
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
  shortcuts?: Shortcut[];
  taskTemplates?: TaskTemplate[];
}

export interface Shortcut {
  id: string;
  name: string;
  icon?: string;
  prompt: string;
  model?: string;
  workingDir?: string;
  color?: string;
  mode?: 'one-time' | 'loop';
}

export interface TaskTemplate {
  id: string;
  name: string;
  icon?: string;
  cardTitle: string;
  description: string;
  checklist: string[];
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface BoardBackground {
  type: 'color' | 'gradient' | 'image';
  value: string;
}

export interface List {
  id: string;
  boardId: string;
  title: string;
  cardIds: string[];
  isArchived: boolean;
}

export interface Card {
  id: string;
  listId: string;
  boardId: string;
  title: string;
  description?: string;
  labelIds: string[];
  memberIds: string[];
  checklists: Checklist[];
  dueDate?: string;
  isDueDateComplete: boolean;
  attachments: Attachment[];
  comments: CardComment[];
  coverColor?: string;
  coverImage?: string;
  isArchived: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  claudeTaskId?: string;
  claudeTaskStatus?: 'queued' | 'running' | 'loop' | 'completed' | 'failed' | 'stopped';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  taskGroup?: string;
  taskOrder?: number;
  scheduledAt?: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  isChecked: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  addedAt: string;
}

export interface CardComment {
  id: string;
  memberId: string;
  text: string;
  createdAt: string;
  editedAt?: string;
}

export interface Member {
  id: string;
  name: string;
  avatar: string;
  color: string;
}
