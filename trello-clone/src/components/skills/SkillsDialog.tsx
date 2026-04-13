import React, { useEffect, useRef, useState } from 'react';
import {
  X, Upload, Library, Sparkles, FileText, Loader2, Check, AlertCircle, FolderOpen, Save
} from 'lucide-react';
import { Board } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  fsWrite,
  listSkillLibrary,
  getSkillFromLibrary,
  type SkillLibraryEntry,
} from '../../services/claudeRunner';
import { generateSkillMarkdown } from '../../services/ai';
import './skills-dialog.css';

interface SkillsDialogProps {
  board: Board;
  onClose: () => void;
}

type Tab = 'upload' | 'library' | 'generate';

// Slug a human name into a safe filename stem (kebab-case, alphanumerics).
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'skill';
}

const SkillsDialog: React.FC<SkillsDialogProps> = ({ board, onClose }) => {
  const workingDir = useSettingsStore(s => s.workingDir);

  // Target folder rule: `<workingDir>/.claude/skills`. User can override
  // the parent dir if they want, but the dialog hides that complexity by
  // default and only surfaces the final resolved path.
  const [targetSubdir, setTargetSubdir] = useState('.claude/skills');

  const [tab, setTab] = useState<Tab>('upload');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [lastSavedPath, setLastSavedPath] = useState('');

  // Upload tab
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');

  // Library tab
  const [library, setLibrary] = useState<SkillLibraryEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [libraryPreview, setLibraryPreview] = useState('');
  const [libraryPreviewLoading, setLibraryPreviewLoading] = useState(false);

  // Generate tab
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateName, setGenerateName] = useState('');

  useEffect(() => {
    if (tab === 'library' && library.length === 0 && !libraryLoading) {
      setLibraryLoading(true);
      setLibraryError('');
      listSkillLibrary()
        .then((items) => setLibrary(items))
        .catch((e) => setLibraryError(String(e instanceof Error ? e.message : e)))
        .finally(() => setLibraryLoading(false));
    }
  }, [tab, library.length, libraryLoading]);

  useEffect(() => {
    if (!selectedLibrary) { setLibraryPreview(''); return; }
    setLibraryPreviewLoading(true);
    getSkillFromLibrary(selectedLibrary)
      .then((data) => setLibraryPreview(data.raw))
      .catch((e) => { setLibraryPreview(`Error: ${String(e)}`); })
      .finally(() => setLibraryPreviewLoading(false));
  }, [selectedLibrary]);

  const handleFileChoose = (file: File) => {
    setUploadFileName(file.name);
    // Default the skill name to the filename stem.
    setUploadName(slugify(file.name.replace(/\.md$/i, '')));
    const reader = new FileReader();
    reader.onload = (e) => setUploadContent(String(e.target?.result ?? ''));
    reader.readAsText(file);
  };

  const resolveDestination = (name: string): string => {
    if (!workingDir) throw new Error('No working directory set. Open Settings and pick one first.');
    const base = workingDir.replace(/\/+$/, '');
    const sub = targetSubdir.replace(/^\/+|\/+$/g, '');
    const safeName = slugify(name);
    return `${base}/${sub}/${safeName}.md`;
  };

  const handleSave = async (name: string, content: string) => {
    setStatus('saving');
    setStatusMsg('');
    try {
      if (!content.trim()) throw new Error('Content is empty.');
      if (!name.trim()) throw new Error('Skill name is required.');
      const target = resolveDestination(name);
      const result = await fsWrite(target, content);
      setStatus('done');
      setLastSavedPath(result.path);
      setStatusMsg(`Saved ${result.bytes} bytes`);
    } catch (err) {
      setStatus('error');
      setStatusMsg(String(err instanceof Error ? err.message : err));
    }
  };

  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return;
    setGenerating(true);
    setGeneratedContent('');
    setStatus('idle');
    setStatusMsg('');
    try {
      const md = await generateSkillMarkdown(generatePrompt, (partial) => setGeneratedContent(partial));
      setGeneratedContent(md);
      // Auto-derive a skill name from the generated title
      const titleMatch = md.match(/^title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m);
      if (titleMatch && !generateName) setGenerateName(slugify(titleMatch[1]));
    } catch (err) {
      setStatus('error');
      setStatusMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setGenerating(false);
    }
  };

  const previewDestination = (name: string) => {
    if (!workingDir) return '(set a working directory first)';
    try { return resolveDestination(name || 'new-skill'); } catch { return ''; }
  };

  return (
    <div className="skills-backdrop" onClick={onClose}>
      <div className="skills-panel" onClick={e => e.stopPropagation()}>
        <div className="skills-header">
          <div className="skills-title">
            <Sparkles size={16} />
            <span>Skills — {board.title}</span>
          </div>
          <button className="skills-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Target directory */}
        <div className="skills-target-bar">
          <FolderOpen size={13} />
          <span className="skills-target-label">Saving under</span>
          <code className="skills-target-path">
            {workingDir ? `${workingDir.replace(/\/+$/, '')}/${targetSubdir.replace(/^\/+|\/+$/g, '')}/` : '(no working directory set)'}
          </code>
          <input
            type="text"
            className="skills-target-input"
            value={targetSubdir}
            onChange={(e) => setTargetSubdir(e.target.value)}
            title="Subdirectory inside the working directory"
          />
        </div>

        {/* Tabs */}
        <div className="skills-tabs">
          <button
            className={`skills-tab ${tab === 'upload' ? 'skills-tab--active' : ''}`}
            onClick={() => setTab('upload')}
          >
            <Upload size={13} />
            <span>Upload</span>
          </button>
          <button
            className={`skills-tab ${tab === 'library' ? 'skills-tab--active' : ''}`}
            onClick={() => setTab('library')}
          >
            <Library size={13} />
            <span>Library</span>
          </button>
          <button
            className={`skills-tab ${tab === 'generate' ? 'skills-tab--active' : ''}`}
            onClick={() => setTab('generate')}
          >
            <Sparkles size={13} />
            <span>Generate (AI)</span>
          </button>
        </div>

        <div className="skills-body">
          {tab === 'upload' && (
            <div className="skills-section">
              <p className="skills-hint">
                Pick a local <code>.md</code> file and save it into this board's project folder.
              </p>
              <div className="skills-file-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,text/markdown"
                  style={{ display: 'none' }}
                  onChange={e => e.target.files?.[0] && handleFileChoose(e.target.files[0])}
                />
                <button className="skills-btn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={13} />
                  Choose .md file
                </button>
                {uploadFileName && <span className="skills-filename">{uploadFileName}</span>}
              </div>
              {uploadContent && (
                <>
                  <label className="skills-label">
                    <FileText size={12} />
                    <span>Skill name (saved as <code>{uploadName || 'name'}.md</code>)</span>
                  </label>
                  <input
                    type="text"
                    className="skills-input"
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                  />
                  <label className="skills-label">
                    <FileText size={12} />
                    <span>Preview</span>
                  </label>
                  <textarea
                    className="skills-textarea"
                    rows={10}
                    value={uploadContent}
                    onChange={e => setUploadContent(e.target.value)}
                  />
                  <div className="skills-action-bar">
                    <span className="skills-destpreview">→ <code>{previewDestination(uploadName)}</code></span>
                    <button
                      className="skills-btn skills-btn--primary"
                      onClick={() => handleSave(uploadName, uploadContent)}
                      disabled={status === 'saving' || !workingDir}
                    >
                      {status === 'saving' ? <Loader2 size={13} className="skills-spin" /> : <Save size={13} />}
                      Save to folder
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'library' && (
            <div className="skills-section">
              <p className="skills-hint">Pre-built skills bundled with the runner. Click one to preview, then save it into your project.</p>
              {libraryError && <div className="skills-error"><AlertCircle size={13} /> {libraryError}</div>}
              <div className="skills-library-grid">
                <div className="skills-library-list">
                  {libraryLoading && <div className="skills-empty"><Loader2 size={14} className="skills-spin" /> Loading…</div>}
                  {!libraryLoading && library.length === 0 && !libraryError && (
                    <div className="skills-empty">No bundled skills yet.</div>
                  )}
                  {library.map(s => (
                    <button
                      key={s.name}
                      className={`skills-library-card ${selectedLibrary === s.name ? 'skills-library-card--active' : ''}`}
                      onClick={() => setSelectedLibrary(s.name)}
                    >
                      <div className="skills-library-card-title">{s.title}</div>
                      {s.description && <div className="skills-library-card-desc">{s.description}</div>}
                      {s.tags.length > 0 && (
                        <div className="skills-library-card-tags">
                          {s.tags.map(tag => <span key={tag} className="skills-library-card-tag">{tag}</span>)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <div className="skills-library-preview">
                  {libraryPreviewLoading && <div className="skills-empty"><Loader2 size={14} className="skills-spin" /> Loading preview…</div>}
                  {!selectedLibrary && !libraryPreviewLoading && (
                    <div className="skills-empty">Pick a skill on the left to preview.</div>
                  )}
                  {selectedLibrary && !libraryPreviewLoading && (
                    <>
                      <pre className="skills-preview-pre">{libraryPreview}</pre>
                      <div className="skills-action-bar">
                        <span className="skills-destpreview">→ <code>{previewDestination(selectedLibrary)}</code></span>
                        <button
                          className="skills-btn skills-btn--primary"
                          onClick={() => handleSave(selectedLibrary, libraryPreview)}
                          disabled={status === 'saving' || !workingDir}
                        >
                          {status === 'saving' ? <Loader2 size={13} className="skills-spin" /> : <Save size={13} />}
                          Save to folder
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'generate' && (
            <div className="skills-section">
              <p className="skills-hint">
                Describe what you want the skill to do — the AI will draft a full <code>SKILL.md</code> file. You can edit it before saving.
              </p>
              <label className="skills-label">
                <Sparkles size={12} />
                <span>Describe the skill</span>
              </label>
              <textarea
                className="skills-textarea"
                rows={3}
                placeholder="e.g. A skill that audits a React component for missing useMemo / useCallback opportunities and outputs a concrete refactor list."
                value={generatePrompt}
                onChange={e => setGeneratePrompt(e.target.value)}
              />
              <div className="skills-action-bar">
                <button
                  className="skills-btn"
                  onClick={handleGenerate}
                  disabled={!generatePrompt.trim() || generating}
                >
                  {generating ? <Loader2 size={13} className="skills-spin" /> : <Sparkles size={13} />}
                  Generate
                </button>
              </div>
              {generatedContent && (
                <>
                  <label className="skills-label">
                    <FileText size={12} />
                    <span>Skill name (saved as <code>{generateName || 'name'}.md</code>)</span>
                  </label>
                  <input
                    type="text"
                    className="skills-input"
                    value={generateName}
                    onChange={e => setGenerateName(e.target.value)}
                  />
                  <label className="skills-label">
                    <FileText size={12} />
                    <span>Generated markdown (editable)</span>
                  </label>
                  <textarea
                    className="skills-textarea"
                    rows={14}
                    value={generatedContent}
                    onChange={e => setGeneratedContent(e.target.value)}
                  />
                  <div className="skills-action-bar">
                    <span className="skills-destpreview">→ <code>{previewDestination(generateName)}</code></span>
                    <button
                      className="skills-btn skills-btn--primary"
                      onClick={() => handleSave(generateName, generatedContent)}
                      disabled={status === 'saving' || !workingDir}
                    >
                      {status === 'saving' ? <Loader2 size={13} className="skills-spin" /> : <Save size={13} />}
                      Save to folder
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {status !== 'idle' && (
          <div className={`skills-status skills-status--${status}`}>
            {status === 'saving' && <><Loader2 size={13} className="skills-spin" /> Saving…</>}
            {status === 'done' && <><Check size={13} /> Saved to <code>{lastSavedPath}</code></>}
            {status === 'error' && <><AlertCircle size={13} /> {statusMsg}</>}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsDialog;
