import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, Loader2, CheckCircle2, AlertCircle, Terminal, ImagePlus, Cpu, ChevronDown, CalendarClock, ListTodo, MessageCircle, Clock, Mic, MicOff, Volume2, VolumeX, LayoutList, FileText, Lightbulb, FilePlus2, Zap } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Board } from '../../types';
import { useBoardStore } from '../../stores/boardStore';
import { analyzeRequirements, generateCardFromDescription, chatWithImage, freeChat, voiceChat, ideationChat, summarizeIdeasForTask } from '../../services/ai';
import { createRunnerTask, listModels, type RunnerModel } from '../../services/claudeRunner';
import { useSettingsStore } from '../../stores/settingsStore';
import { getEffectiveShortcuts, EffectiveShortcut } from '../../lib/shortcuts';
import './ai-assistant.css';

type ChatMode = 'schedule' | 'plan' | 'chat' | 'ideas' | 'shortcut' | 'voice';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  createdCards?: string[];
  isLoading?: boolean;
  isError?: boolean;
}

interface AIAssistantProps {
  board: Board;
  onClose: () => void;
}

const MODE_CONFIG: Record<ChatMode, { icon: React.ReactNode; label: string; placeholder: string; color: string }> = {
  schedule: {
    icon: <CalendarClock size={13} />,
    label: 'Schedule',
    placeholder: 'Describe tasks to schedule… AI will create cards with your scheduled time.',
    color: '#FF9F1A',
  },
  plan: {
    icon: <ListTodo size={13} />,
    label: 'Plan',
    placeholder: 'Describe requirements… AI will break them into task cards in To Do.',
    color: '#667eea',
  },
  chat: {
    icon: <MessageCircle size={13} />,
    label: 'Chat',
    placeholder: 'Ask anything… brainstorm ideas, discuss approaches.',
    color: '#61BD4F',
  },
  ideas: {
    icon: <Lightbulb size={13} />,
    label: 'Ideas',
    placeholder: 'Describe a vague idea… the AI will deep-dive with you until you can ship it.',
    color: '#F2D600',
  },
  shortcut: {
    icon: <Zap size={13} />,
    label: 'Shortcut',
    placeholder: 'Click a shortcut below to fire it into Claude Code Runner.',
    color: '#C377E0',
  },
  voice: {
    icon: <Mic size={13} />,
    label: 'Voice',
    placeholder: 'Press the mic button to speak, or type here…',
    color: '#EB5A46',
  },
};

const AIAssistant: React.FC<AIAssistantProps> = ({ board, onClose }) => {
  const [chatMode, setChatMode] = useState<ChatMode>('plan');
  const [taskStyle, setTaskStyle] = useState<'multiple' | 'single'>('multiple');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm your AI assistant for the "${board.title}" board.\n\nChoose a mode:\n• Schedule — create tasks with a scheduled execution time\n• Plan — break down requirements into To Do cards\n• Chat — free-form Q&A\n• Ideas — deep-talk brainstorming; click "Create task from these ideas" when done to spawn an ideas.md card`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ base64: string; previewUrl: string } | null>(null);
  const [models, setModels] = useState<RunnerModel[]>([]);
  const [localModel, setLocalModel] = useState(useSettingsStore.getState().selectedModel);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const getDefaultScheduleTime = () => {
    const t = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };
  const [scheduleTime, setScheduleTime] = useState(getDefaultScheduleTime);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [ideasHistory, setIdeasHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [isCreatingIdeaCard, setIsCreatingIdeaCard] = useState(false);
  const [voiceHistory, setVoiceHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const lists = useBoardStore(s => s.lists);
  const createCard = useBoardStore(s => s.createCard);
  const updateCard = useBoardStore(s => s.updateCard);
  const addChecklist = useBoardStore(s => s.addChecklist);
  const globalShortcuts = useSettingsStore(s => s.globalShortcuts);
  const effectiveShortcuts: EffectiveShortcut[] = getEffectiveShortcuts(board, globalShortcuts);
  const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);
  const addChecklistItem = useBoardStore(s => s.addChecklistItem);
  const createLabel = useBoardStore(s => s.createLabel);

  const findList = (match: (title: string) => boolean) =>
    board.listIds.map(id => lists[id]).filter(Boolean).find(l => match(l.title.toLowerCase().trim()));

  const todoList = findList(t => t.includes('to do') || t === 'todo' || t === 'backlog')
    ?? (board.listIds.length > 0 ? lists[board.listIds[0]] : null);

  const scheduledList = findList(t => t === 'scheduled');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    listModels().then(setModels).catch(() => {});
  }, []);

  const WORKING_DIR = useSettingsStore(s => s.workingDir);

  // ─── Speech helpers ───
  const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  const speechSupported = !!SpeechRecognitionAPI;

  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const startRecording = () => {
    if (!SpeechRecognitionAPI || isRecording) return;
    const recognition = new (SpeechRecognitionAPI as new () => SpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ─── Image handling ───
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPendingImage({ base64: dataUrl.split(',')[1], previewUrl: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSendImage = async () => {
    if (!pendingImage || isLoading) return;
    const prompt = input.trim() || 'What is in this image? Describe it in detail.';
    const imagePreview = pendingImage.previewUrl;
    const imageBase64 = pendingImage.base64;

    const userMsg: Message = { id: uuidv4(), role: 'user', content: prompt, imageUrl: imagePreview };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMsg, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setPendingImage(null);
    setIsLoading(true);

    try {
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial, isLoading: true } : m
        ));
      };
      const result = await chatWithImage(prompt, imageBase64, onChunk);
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: result,
      }));
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY.'
        : raw.includes('does not support images') || raw.includes('vision')
        ? 'This model does not support image analysis.'
        : `Error analyzing image: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Run with Claude Code ───
  const handleRunWithClaude = async () => {
    if (!input.trim() || isLoading) return;
    const prompt = input.trim();
    const userMsg: Message = { id: uuidv4(), role: 'user', content: `[Claude Code] ${prompt}` };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMsg, { id: loadingId, role: 'assistant', content: 'Starting Claude Code task...', isLoading: true }]);
    setInput('');
    setIsLoading(true);
    try {
      const task = await createRunnerTask(prompt, WORKING_DIR || undefined, undefined, localModel || undefined, board.id);
      if (todoList) {
        const card = createCard(todoList.id, board.id, prompt.slice(0, 60));
        updateCard(card.id, { description: prompt, claudeTaskId: task.id, claudeTaskStatus: task.status });
      }
      const modelLabel = localModel ? `\nModel: ${localModel}` : '';
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant',
        content: `Claude Code task started! Task ID: ${task.id.slice(0, 8)}...${modelLabel}\nStatus: ${task.status}\n\nA tracking card has been created.`,
      }));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant',
        content: `Failed to start Claude Code task: ${String(e)}.\nMake sure Claude Code Runner is running at localhost:3456.`,
        isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Helper: create cards from AI suggestions ───
  const createCardsFromTasks = (tasks: Awaited<ReturnType<typeof analyzeRequirements>>, targetList: typeof todoList, scheduledAt?: string, originalInput?: string) => {
    if (!targetList) return [];
    const createdTitles: string[] = [];
    const sortedTasks = [...tasks].sort((a, b) => (a.taskOrder ?? 99) - (b.taskOrder ?? 99));

    for (const task of sortedTasks) {
      const card = createCard(targetList.id, board.id, task.title);

      const cardUpdate: Record<string, unknown> = {};
      cardUpdate.description = task.description || originalInput || task.title;
      if (task.priority) cardUpdate.priority = task.priority;
      if (task.taskGroup) cardUpdate.taskGroup = task.taskGroup;
      if (task.taskOrder != null) cardUpdate.taskOrder = task.taskOrder;
      if (scheduledAt) cardUpdate.scheduledAt = scheduledAt;
      if (Object.keys(cardUpdate).length > 0) updateCard(card.id, cardUpdate);

      for (const labelSpec of task.labels ?? []) {
        const { boards } = useBoardStore.getState();
        const freshBoard = boards[board.id];
        const existing = freshBoard?.labels.find(l => l.name === labelSpec.name);
        const labelId = existing
          ? existing.id
          : createLabel(board.id, labelSpec.name, labelSpec.color).id;
        const freshCard = useBoardStore.getState().cards[card.id];
        if (freshCard && !freshCard.labelIds.includes(labelId)) {
          updateCard(card.id, { labelIds: [...freshCard.labelIds, labelId] });
        }
      }

      if (task.checklist && task.checklist.length > 0) {
        addChecklist(card.id, 'Tasks');
        const freshCard = useBoardStore.getState().cards[card.id];
        const checklist = freshCard?.checklists[freshCard.checklists.length - 1];
        if (checklist) {
          for (const item of task.checklist) {
            addChecklistItem(card.id, checklist.id, item);
          }
        }
      }

      const priorityIcon = task.priority === 'critical' ? '🔴' : task.priority === 'high' ? '🟠' : task.priority === 'medium' ? '🟡' : '🟢';
      const groupInfo = task.taskGroup ? ` [${task.taskGroup}${task.taskOrder ? ` #${task.taskOrder}` : ''}]` : '';
      createdTitles.push(`${priorityIcon} ${task.title}${groupInfo}`);
    }

    return createdTitles;
  };

  // ─── Helper: create single detailed card ───
  const createSingleCard = (task: Awaited<ReturnType<typeof generateCardFromDescription>>, targetList: typeof todoList, scheduledAt?: string, originalInput?: string) => {
    if (!targetList) return '';
    const card = createCard(targetList.id, board.id, task.title);

    const cardUpdate: Record<string, unknown> = {};
    cardUpdate.description = task.description || originalInput || task.title;
    if (task.priority) cardUpdate.priority = task.priority;
    if (scheduledAt) cardUpdate.scheduledAt = scheduledAt;
    if (Object.keys(cardUpdate).length > 0) updateCard(card.id, cardUpdate);

    for (const labelSpec of task.labels ?? []) {
      const { boards } = useBoardStore.getState();
      const freshBoard = boards[board.id];
      const existing = freshBoard?.labels.find(l => l.name === labelSpec.name);
      const labelId = existing
        ? existing.id
        : createLabel(board.id, labelSpec.name, labelSpec.color).id;
      const freshCard = useBoardStore.getState().cards[card.id];
      if (freshCard && !freshCard.labelIds.includes(labelId)) {
        updateCard(card.id, { labelIds: [...freshCard.labelIds, labelId] });
      }
    }

    if (task.checklist && task.checklist.length > 0) {
      addChecklist(card.id, 'Tasks');
      const freshCard = useBoardStore.getState().cards[card.id];
      const checklist = freshCard?.checklists[freshCard.checklists.length - 1];
      if (checklist) {
        for (const item of task.checklist) {
          addChecklistItem(card.id, checklist.id, item);
        }
      }
    }

    return task.title;
  };

  // ─── Mode: Schedule ───
  const handleSchedule = async () => {
    if (!input.trim() || isLoading) return;
    const effectiveScheduleTime = scheduleTime || getDefaultScheduleTime();

    const targetList = scheduledList || todoList;
    if (!targetList) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'assistant', content: 'No list found. Create a list first.', isError: true }]);
      return;
    }

    const originalInput = input.trim();
    const userMessage: Message = { id: uuidv4(), role: 'user', content: `[Schedule @ ${new Date(effectiveScheduleTime).toLocaleString()}]\n${originalInput}` };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const existingLabels = board.labels.map(l => ({ name: l.name, color: l.color }));
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial } : m
        ));
      };

      const scheduledAt = new Date(effectiveScheduleTime).toISOString();
      const timeStr = new Date(effectiveScheduleTime).toLocaleString();

      if (taskStyle === 'single') {
        const task = await generateCardFromDescription(originalInput, existingLabels, onChunk);
        const title = createSingleCard(task, targetList, scheduledAt, originalInput);
        setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
          id: uuidv4(), role: 'assistant',
          content: `Created 1 detailed scheduled task in "${targetList.title}".\nScheduled for: ${timeStr}\n\nWhen the time arrives, it will auto-move to "In Progress" and start executing.`,
          createdCards: title ? [title] : [],
        }));
      } else {
        const tasks = await analyzeRequirements(userMessage.content, existingLabels, onChunk);
        const createdTitles = createCardsFromTasks(tasks, targetList, scheduledAt, originalInput);
        setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
          id: uuidv4(), role: 'assistant',
          content: `Created ${tasks.length} scheduled task${tasks.length !== 1 ? 's' : ''} in "${targetList.title}".\nScheduled for: ${timeStr}\n\nWhen the time arrives, tasks will auto-move to "In Progress" and start executing.`,
          createdCards: createdTitles,
        }));
      }
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY.'
        : `Sorry, an error occurred: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Mode: Plan ───
  const handlePlan = async () => {
    if (!input.trim() || isLoading) return;
    if (!todoList) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'assistant', content: 'No list found. Create a list first.', isError: true }]);
      return;
    }

    const originalInput = input.trim();
    const userMessage: Message = { id: uuidv4(), role: 'user', content: originalInput };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const existingLabels = board.labels.map(l => ({ name: l.name, color: l.color }));
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial } : m
        ));
      };

      if (taskStyle === 'single') {
        const task = await generateCardFromDescription(originalInput, existingLabels, onChunk);
        const title = createSingleCard(task, todoList, undefined, originalInput);
        setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
          id: uuidv4(), role: 'assistant',
          content: `Created 1 detailed task in "${todoList.title}" with description, checklist, labels, and priority.`,
          createdCards: title ? [title] : [],
        }));
      } else {
        const tasks = await analyzeRequirements(originalInput, existingLabels, onChunk);
        const createdTitles = createCardsFromTasks(tasks, todoList, undefined, originalInput);

        const groups = [...new Set(tasks.map(t => t.taskGroup).filter(Boolean))];
        const groupSummary = groups.length > 0 ? `\nGroups: ${groups.join(', ')}` : '';

        setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
          id: uuidv4(), role: 'assistant',
          content: `I've created ${tasks.length} task${tasks.length !== 1 ? 's' : ''} in "${todoList.title}" with priorities and execution order:${groupSummary}\n\nDrag the first card to "In Progress" to start.`,
          createdCards: createdTitles,
        }));
      }
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY in your .env file.'
        : raw.includes('500')
        ? 'Ollama server error (500). Try again in a moment.'
        : raw.includes('fetch') || raw.includes('Failed to fetch')
        ? 'Could not reach the Ollama server. Check your connection.'
        : `Sorry, an error occurred: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Mode: Chat ───
  const handleChat = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();

    const userMessage: Message = { id: uuidv4(), role: 'user', content: text };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial, isLoading: true } : m
        ));
      };

      const result = await freeChat(text, chatHistory, onChunk);

      setChatHistory(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: result }]);

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: result,
      }));
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY.'
        : `Error: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Mode: Shortcut (one-click runner commands) ───
  // Fires the shortcut's prompt straight at Claude Code Runner while still
  // creating a tracking card in the To Do list, mirroring the existing
  // Run-with-Claude flow so task polling + auto-promote behave normally.
  const handleRunShortcut = async (shortcut: EffectiveShortcut) => {
    if (runningShortcutId) return;
    setRunningShortcutId(shortcut.id);

    const loadingId = uuidv4();
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: `Firing shortcut “${shortcut.name}”…`,
      isLoading: true,
    }]);

    try {
      const boardLists = board.listIds.map(id => lists[id]).filter(Boolean);
      // Shortcuts fire straight into Claude Code, so the tracking card should
      // land in In Progress (it's already running), not To Do. Fall back to
      // To Do / first list if no In Progress list exists.
      const inProgressList =
        boardLists.find(l => /in\s*progress|inprogress|in-progress/i.test(l.title)) ||
        boardLists.find(l => /to\s*do|todo|backlog/i.test(l.title)) ||
        boardLists[0];
      if (!inProgressList) throw new Error('No lists on this board — create one first.');

      const runnerModel = shortcut.model || localModel || undefined;
      const runnerDir = shortcut.workingDir || WORKING_DIR || undefined;
      const runnerMode = shortcut.mode || 'one-time';

      const task = await createRunnerTask(shortcut.prompt, runnerDir, undefined, runnerModel, board.id, runnerMode);

      // Tracking card in the existing task channel
      const cardTitle = `${shortcut.icon ? shortcut.icon + ' ' : ''}${shortcut.name}`.trim() || 'Shortcut';
      const card = createCard(inProgressList.id, board.id, cardTitle);
      updateCard(card.id, {
        description: shortcut.prompt,
        claudeTaskId: task.id,
        claudeTaskStatus: task.status,
      });

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(),
        role: 'assistant',
        content: `Shortcut sent to Claude Code Runner.\nTask ID: ${task.id.slice(0, 8)}…\nStatus: ${task.status}`,
        createdCards: [cardTitle],
      }));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(),
        role: 'assistant',
        content: `Shortcut failed: ${String(e)}`,
        isError: true,
      }));
    } finally {
      setRunningShortcutId(null);
    }
  };

  // ─── Mode: Ideas (Deep-talk brainstorming) ───
  const handleIdeas = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();

    const userMessage: Message = { id: uuidv4(), role: 'user', content: text };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial, isLoading: true } : m
        ));
      };

      const result = await ideationChat(text, ideasHistory, onChunk);

      setIdeasHistory(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: result }]);

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: result,
      }));
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY.'
        : `Error: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Turn the ideation transcript into a To Do card whose description tells
  // Claude Code to create an ideas.md file with the distilled ideas.
  const handleCreateTaskFromIdeas = async () => {
    if (isCreatingIdeaCard || ideasHistory.length === 0) return;
    setIsCreatingIdeaCard(true);

    const loadingId = uuidv4();
    setMessages(prev => [...prev, { id: loadingId, role: 'assistant', content: 'Distilling the conversation into a card…', isLoading: true }]);

    try {
      const { title, markdown } = await summarizeIdeasForTask(ideasHistory);

      // Find the To Do list on this board (fall back to first list)
      const boardLists = board.listIds.map(id => lists[id]).filter(Boolean);
      const todoList = boardLists.find(l => /to\s*do|todo|backlog/i.test(l.title)) || boardLists[0];
      if (!todoList) {
        throw new Error('No lists available on this board — add a list first.');
      }

      const description = `Please create an \`ideas.md\` file in the project folder that captures the brainstorm below. Use the markdown verbatim as the file contents. After writing the file, commit it with message "docs: add ideas.md from brainstorm".

# File: ideas.md

${markdown}`;

      const card = createCard(todoList.id, board.id, title || 'Ideas from brainstorm');
      updateCard(card.id, { description });

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(),
        role: 'assistant',
        content: `Created a new card in "${todoList.title}": ${title}\n\nThe card tells Claude Code to write \`ideas.md\` with the distilled notes.`,
        createdCards: [title],
      }));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(),
        role: 'assistant',
        content: `Failed to create card: ${String(e)}`,
        isError: true,
      }));
    } finally {
      setIsCreatingIdeaCard(false);
    }
  };

  // ─── Mode: Voice ───
  const handleVoice = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();

    const userMessage: Message = { id: uuidv4(), role: 'user', content: `🎤 ${text}` };
    const loadingId = uuidv4();
    setMessages(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const onChunk = (partial: string) => {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, content: partial, isLoading: true } : m
        ));
      };

      const result = await voiceChat(text, voiceHistory, onChunk);

      setVoiceHistory(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: result }]);

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: result,
      }));

      // Auto-speak the response
      if (autoSpeak) {
        speakText(result);
      }
    } catch (e) {
      const raw = String(e);
      const friendly = raw.includes('401') || raw.includes('403')
        ? 'Authentication failed. Check VITE_OLLAMA_API_KEY.'
        : `Error: ${raw}`;
      setMessages(prev => prev.filter(m => m.id !== loadingId).concat({
        id: uuidv4(), role: 'assistant', content: friendly, isError: true,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Dispatch based on mode ───
  const handleSubmit = () => {
    if (pendingImage) return handleSendImage();
    switch (chatMode) {
      case 'schedule': return handleSchedule();
      case 'plan': return handlePlan();
      case 'chat': return handleChat();
      case 'ideas': return handleIdeas();
      case 'shortcut': return; // shortcut mode has no text input — user clicks cards
      case 'voice': return handleVoice();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const modeConfig = MODE_CONFIG[chatMode];

  return (
    <div className="ai-assistant">
      <div className="ai-assistant-header">
        <div className="ai-assistant-title">
          <Bot size={18} />
          <span>AI Assistant</span>
        </div>
        <button className="ai-assistant-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Mode Tabs */}
      <div className="ai-mode-tabs">
        {(Object.keys(MODE_CONFIG) as ChatMode[]).map(mode => (
          <button
            key={mode}
            className={`ai-mode-tab ${chatMode === mode ? 'ai-mode-tab--active' : ''}`}
            onClick={() => { setChatMode(mode); if (mode === 'schedule') setScheduleTime(getDefaultScheduleTime()); }}
            style={chatMode === mode ? { borderColor: MODE_CONFIG[mode].color, color: MODE_CONFIG[mode].color } : {}}
          >
            {MODE_CONFIG[mode].icon}
            <span>{MODE_CONFIG[mode].label}</span>
          </button>
        ))}
      </div>

      <div className="ai-assistant-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`ai-msg ai-msg--${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="ai-msg-avatar">
                <Bot size={13} />
              </div>
            )}
            <div className={`ai-msg-bubble${msg.isError ? ' ai-msg-bubble--error' : ''}`}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="Uploaded" className="ai-msg-image" />
              )}
              {msg.isLoading ? (
                <div className="ai-msg-loading">
                  <Loader2 size={14} className="ai-spin" />
                  {msg.content
                    ? <span className="ai-msg-stream">{msg.content}</span>
                    : <span>Thinking…</span>
                  }
                </div>
              ) : (
                <>
                  {msg.isError && <AlertCircle size={14} style={{ flexShrink: 0 }} />}
                  <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                  {msg.createdCards && (
                    <ul className="ai-created-list">
                      {msg.createdCards.map((title, i) => (
                        <li key={i}>
                          <CheckCircle2 size={12} />
                          <span>{title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-assistant-footer">
        {/* Schedule time picker */}
        {chatMode === 'schedule' && (
          <div className="ai-schedule-bar">
            <Clock size={13} />
            <input
              type="datetime-local"
              className="ai-schedule-input"
              value={scheduleTime}
              onChange={e => setScheduleTime(e.target.value)}
            />
            {!scheduleTime && <span className="ai-schedule-hint">Default: now + 5 min</span>}
          </div>
        )}

        {/* Model Picker (for modes that hit the runner, not the pure-chat modes) */}
        {chatMode !== 'chat' && chatMode !== 'ideas' && chatMode !== 'shortcut' && (
          <div className="ai-model-bar">
            <button
              className="ai-model-toggle"
              onClick={() => setShowModelPicker(!showModelPicker)}
              title="Select AI model for Claude Code Runner"
            >
              <Cpu size={12} />
              <span>{localModel ? models.find(m => m.id === localModel)?.name || localModel : 'Default model'}</span>
              <ChevronDown size={12} />
            </button>
            {showModelPicker && (
              <div className="ai-model-dropdown">
                <button
                  className={`ai-model-option ${!localModel ? 'ai-model-option--active' : ''}`}
                  onClick={() => { setLocalModel(''); setShowModelPicker(false); }}
                >
                  Default model
                </button>
                {models.map(m => (
                  <button
                    key={m.id}
                    className={`ai-model-option ${localModel === m.id ? 'ai-model-option--active' : ''}`}
                    onClick={() => { setLocalModel(m.id); setShowModelPicker(false); }}
                  >
                    {m.name || m.id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Image Preview */}
        {pendingImage && (
          <div className="ai-image-preview">
            <img src={pendingImage.previewUrl} alt="Preview" />
            <button className="ai-image-preview-remove" onClick={() => setPendingImage(null)} title="Remove image">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Shortcut mode — grid of effective shortcuts */}
        {chatMode === 'shortcut' && (
          <div className="ai-shortcut-bar">
            {effectiveShortcuts.length === 0 ? (
              <p className="ai-shortcut-empty">
                No shortcuts yet — add some in Settings → Global Shortcuts or Board Shortcuts.
              </p>
            ) : (
              <div className="ai-shortcut-grid">
                {effectiveShortcuts.map(sc => (
                  <button
                    key={sc.id}
                    className={`ai-shortcut-card ai-shortcut-card--${sc.source}`}
                    onClick={() => handleRunShortcut(sc)}
                    disabled={runningShortcutId !== null || !sc.prompt.trim() || !sc.name.trim()}
                    title={sc.prompt || 'Empty shortcut — fill in the prompt in Settings'}
                  >
                    <span className="ai-shortcut-icon">{sc.icon || '⚡'}</span>
                    <span className="ai-shortcut-name">{sc.name || '(unnamed)'}</span>
                    <span className="ai-shortcut-source">{sc.source === 'global' ? 'global' : 'board'}</span>
                    {runningShortcutId === sc.id && <Loader2 size={12} className="ai-spin" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ideas — create card from the brainstorm so far */}
        {chatMode === 'ideas' && ideasHistory.length >= 2 && (
          <div className="ai-ideas-bar">
            <button
              className="ai-ideas-create-btn"
              onClick={handleCreateTaskFromIdeas}
              disabled={isCreatingIdeaCard}
              title="Summarize this brainstorm into a To Do card that tells Claude Code to write ideas.md"
            >
              {isCreatingIdeaCard
                ? <><Loader2 size={13} className="ai-spin" /><span>Creating card…</span></>
                : <><FilePlus2 size={13} /><span>Create task from these ideas</span></>
              }
            </button>
            <span className="ai-ideas-hint">{ideasHistory.length / 2} exchange{ideasHistory.length / 2 !== 1 ? 's' : ''} so far</span>
          </div>
        )}

        {/* Voice recording indicator */}
        {chatMode === 'voice' && isRecording && (
          <div className="ai-voice-indicator">
            <span className="ai-voice-dot" />
            <span>Listening… speak now</span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="ai-assistant-input"
          placeholder={pendingImage ? 'Ask about this image… (Enter to send)' : modeConfig.placeholder}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={isLoading}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />

        {/* Task style toggle — only for schedule & plan modes */}
        {(chatMode === 'schedule' || chatMode === 'plan') && (
          <div className="ai-task-style">
            <button
              className={`ai-task-style-btn ${taskStyle === 'multiple' ? 'ai-task-style-btn--active' : ''}`}
              onClick={() => setTaskStyle('multiple')}
              title="Break into multiple small tasks"
            >
              <LayoutList size={12} />
              <span>Split tasks</span>
            </button>
            <button
              className={`ai-task-style-btn ${taskStyle === 'single' ? 'ai-task-style-btn--active' : ''}`}
              onClick={() => setTaskStyle('single')}
              title="Create one detailed task with full description and checklist"
            >
              <FileText size={12} />
              <span>Single detail</span>
            </button>
          </div>
        )}

        <div className="ai-assistant-actions">
          {chatMode === 'voice' ? (
            <>
              {/* Voice controls */}
              <button
                className={`ai-voice-btn ${isRecording ? 'ai-voice-btn--recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || !speechSupported}
                title={isRecording ? 'Stop recording' : speechSupported ? 'Start recording' : 'Speech not supported in this browser'}
              >
                {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <button
                className={`ai-speak-toggle ${autoSpeak ? 'ai-speak-toggle--active' : ''}`}
                onClick={() => { setAutoSpeak(!autoSpeak); if (isSpeaking) stopSpeaking(); }}
                title={autoSpeak ? 'Auto-speak ON — click to mute' : 'Auto-speak OFF — click to enable'}
              >
                {autoSpeak ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>

              <button
                className="ai-assistant-send"
                onClick={handleSubmit}
                disabled={!input.trim() || isLoading}
                title="Send voice message"
                style={!isLoading ? { background: '#EB5A46' } : {}}
              >
                {isLoading ? <Loader2 size={16} className="ai-spin" /> : <Send size={16} />}
              </button>
            </>
          ) : (
            <>
              <button
                className="ai-image-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title="Upload image for AI analysis"
              >
                <ImagePlus size={16} />
              </button>

              {chatMode !== 'chat' && !pendingImage && (
                <button
                  className="ai-claude-run-btn"
                  onClick={handleRunWithClaude}
                  disabled={!input.trim() || isLoading}
                  title="Run as Claude Code task (direct)"
                >
                  <Terminal size={14} />
                  Run
                </button>
              )}

              <button
                className="ai-assistant-send"
                onClick={handleSubmit}
                disabled={(!input.trim() && !pendingImage) || isLoading}
                title={`Send (${modeConfig.label} mode)`}
                style={!isLoading ? { background: `linear-gradient(135deg, ${modeConfig.color}, ${modeConfig.color}dd)` } : {}}
              >
                {isLoading ? <Loader2 size={16} className="ai-spin" /> : <Send size={16} />}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
