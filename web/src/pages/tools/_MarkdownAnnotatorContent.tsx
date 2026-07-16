import React, { useState, useCallback, useRef, useEffect } from 'react';
import styles from './markdown-annotator.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Annotation {
  id: string;
  lineStart: number;
  lineEnd: number;
  selectedText: string;
  comment: string;
  view: 'code' | 'preview';
}

export type ViewMode = 'code' | 'preview';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function parseGithubUrl(url: string): { rawUrl: string; displayUrl: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[2] !== 'blob') return null;
    const [owner, repo, , ...rest] = parts;
    const branch = rest[0];
    const filePath = rest.slice(1).join('/');
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    return { rawUrl, displayUrl: url };
  } catch {
    return null;
  }
}

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'cpp', cs: 'csharp', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash', yaml: 'yaml', yml: 'yaml',
    json: 'json', toml: 'toml', md: 'markdown', mdx: 'markdown',
    html: 'html', css: 'css', scss: 'scss', sql: 'sql', xml: 'xml',
  };
  return map[ext] ?? 'text';
}

export function isMarkdown(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' || ext === 'mdx';
}

// URL-safe UTF-8 base64 encoding
export function encodeContentForUrl(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function decodeContentFromUrl(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || 'text'}">${code.trimEnd()}</code></pre>\n`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = html.split('\n');
  const output: string[] = [];
  let i = 0;
  let inList: 'ul' | 'ol' | null = null;
  let inBlockquote = false;
  let inPre = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('<pre>')) { inPre = true; output.push(line); i++; continue; }
    if (line.includes('</pre>')) { inPre = false; output.push(line); i++; continue; }
    if (inPre) { output.push(line); i++; continue; }

    const isUl = /^[-*+] /.test(line);
    const isOl = /^\d+\. /.test(line);
    const isBq = line.startsWith('&gt;');

    if (!isUl && !isOl && inList) { output.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
    if (!isBq && inBlockquote) { output.push('</blockquote>'); inBlockquote = false; }

    if (line === '' || line === '\n') { output.push(''); i++; continue; }

    const hMatch = line.match(/^(#{1,6}) (.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      output.push(`<h${level}>${inlineFmt(hMatch[2])}</h${level}>`);
      i++; continue;
    }
    if (/^[-*_]{3,}$/.test(line.trim())) { output.push('<hr/>'); i++; continue; }
    if (isBq) {
      if (!inBlockquote) { output.push('<blockquote>'); inBlockquote = true; }
      output.push(`<p>${inlineFmt(line.replace(/^&gt;\s?/, ''))}</p>`);
      i++; continue;
    }
    if (isUl) {
      if (!inList) { output.push('<ul>'); inList = 'ul'; }
      output.push(`<li>${inlineFmt(line.replace(/^[-*+] /, ''))}</li>`);
      i++; continue;
    }
    if (isOl) {
      if (!inList) { output.push('<ol>'); inList = 'ol'; }
      output.push(`<li>${inlineFmt(line.replace(/^\d+\. /, ''))}</li>`);
      i++; continue;
    }
    output.push(`<p>${inlineFmt(line)}</p>`);
    i++;
  }

  if (inList) output.push(inList === 'ul' ? '</ul>' : '</ol>');
  if (inBlockquote) output.push('</blockquote>');
  return output.join('\n');
}

function inlineFmt(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ── Review prompt ─────────────────────────────────────────────────────────────

export function buildReviewPrompt(opts: {
  content: string;
  filename: string;
  sourceUrl: string | null;
  annotations: Annotation[];
  summary: string;
}): string {
  const { content, filename, sourceUrl, annotations, summary } = opts;
  const lines: string[] = [];

  lines.push('# File Review');
  lines.push('');
  lines.push(`**File:** \`${filename}\``);
  if (sourceUrl) lines.push(`**Source:** ${sourceUrl}`);
  lines.push('');

  if (annotations.length > 0) {
    lines.push('## Inline Annotations');
    lines.push('');
    for (const a of annotations) {
      const range = a.lineStart === a.lineEnd ? `Line ${a.lineStart}` : `Lines ${a.lineStart}–${a.lineEnd}`;
      lines.push(`### ${range}`);
      if (a.selectedText) { lines.push(''); lines.push('```'); lines.push(a.selectedText); lines.push('```'); }
      lines.push(''); lines.push(a.comment); lines.push('');
    }
  }

  if (summary.trim()) { lines.push('## Summary'); lines.push(''); lines.push(summary.trim()); lines.push(''); }

  lines.push('## File Contents');
  lines.push(''); lines.push('```' + detectLanguage(filename)); lines.push(content); lines.push('```');

  return lines.join('\n');
}

// ── Annotation dialog ─────────────────────────────────────────────────────────

interface AnnotationDialogProps {
  lineStart: number;
  lineEnd: number;
  selectedText: string;
  view: ViewMode;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}

export function AnnotationDialog({ lineStart, lineEnd, selectedText, onConfirm, onCancel }: AnnotationDialogProps) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const range = lineStart === lineEnd ? `Line ${lineStart}` : `Lines ${lineStart}–${lineEnd}`;

  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Add comment — {range}</span>
          <button className={styles.dialogClose} onClick={onCancel}>✕</button>
        </div>
        {selectedText && (
          <div className={styles.dialogSelection}>
            <pre className={styles.dialogSelectionText}>
              {selectedText.length > 200 ? selectedText.slice(0, 200) + '…' : selectedText}
            </pre>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className={styles.dialogTextarea}
          placeholder="Write your comment…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (comment.trim()) onConfirm(comment.trim()); }
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className={styles.dialogActions}>
          <button className={styles.dialogCancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.dialogConfirm}
            disabled={!comment.trim()}
            onClick={() => { if (comment.trim()) onConfirm(comment.trim()); }}
          >
            Add comment
          </button>
        </div>
        <div className={styles.dialogHint}>⌘↵ to submit · Esc to cancel</div>
      </div>
    </div>
  );
}

// ── Code view ─────────────────────────────────────────────────────────────────

interface CodeViewProps {
  lines: string[];
  annotations: Annotation[];
  onAnnotationAdd: (lineStart: number, lineEnd: number, selectedText: string) => void;
  onAnnotationDelete: (id: string) => void;
}

export function CodeView({ lines, annotations, onAnnotationAdd, onAnnotationDelete }: CodeViewProps) {
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  const getSelectedRange = (current: number): [number, number] =>
    anchorLine === null ? [current, current] : anchorLine <= current ? [anchorLine, current] : [current, anchorLine];

  const annotationsByLine = new Map<number, Annotation[]>();
  for (const a of annotations) {
    for (let l = a.lineStart; l <= a.lineEnd; l++) {
      const arr = annotationsByLine.get(l) ?? [];
      arr.push(a);
      annotationsByLine.set(l, arr);
    }
  }

  const handleLineClick = (lineNum: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchorLine !== null) {
      const [start, end] = getSelectedRange(lineNum);
      onAnnotationAdd(start, end, lines.slice(start - 1, end).join('\n'));
      setAnchorLine(null);
    } else {
      setAnchorLine(lineNum);
    }
  };

  const [low, high] = anchorLine !== null && hoverLine !== null ? getSelectedRange(hoverLine) : [null, null];

  return (
    <div className={styles.codeView}>
      <div className={styles.codeHint}>
        Click a line number to anchor · Shift+click to select range · Double-click to annotate single line
      </div>
      <div className={styles.codeScroll}>
        <table className={styles.codeTable} cellSpacing={0} cellPadding={0}>
          <tbody>
            {lines.map((lineContent, idx) => {
              const lineNum = idx + 1;
              const isInRange = low !== null && high !== null && lineNum >= low && lineNum <= high;
              const isAnchor = lineNum === anchorLine;
              const hasAnnotation = annotationsByLine.has(lineNum);
              const annotationsHere = annotations.filter((a) => a.lineStart === lineNum);

              return (
                <React.Fragment key={lineNum}>
                  <tr
                    className={`${styles.codeLine} ${isInRange || isAnchor ? styles.codeLineSelected : ''} ${hasAnnotation ? styles.codeLineAnnotated : ''}`}
                    onMouseEnter={() => setHoverLine(lineNum)}
                    onMouseLeave={() => setHoverLine(null)}
                  >
                    <td
                      className={`${styles.lineNum} ${isAnchor ? styles.lineNumAnchor : ''}`}
                      onClick={(e) => handleLineClick(lineNum, e)}
                      onDoubleClick={() => { onAnnotationAdd(lineNum, lineNum, lines[lineNum - 1]); setAnchorLine(null); }}
                      title={anchorLine === null ? 'Click to anchor, shift+click to select range' : 'Shift+click to select range'}
                    >
                      {hasAnnotation && <span className={styles.annotDot} title="Has annotation" />}
                      {lineNum}
                    </td>
                    <td className={styles.lineContent}>
                      <pre className={styles.lineCode}>{lineContent || ' '}</pre>
                    </td>
                  </tr>
                  {annotationsHere.map((a) => (
                    <tr key={a.id} className={styles.annotRow}>
                      <td />
                      <td className={styles.annotCell}>
                        <div className={styles.annotBlock}>
                          <div className={styles.annotMeta}>
                            <span className={styles.annotRange}>
                              {a.lineStart === a.lineEnd ? `Line ${a.lineStart}` : `Lines ${a.lineStart}–${a.lineEnd}`}
                            </span>
                            <button className={styles.annotDelete} onClick={() => onAnnotationDelete(a.id)} title="Delete">✕</button>
                          </div>
                          <div className={styles.annotComment}>{a.comment}</div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Preview view ──────────────────────────────────────────────────────────────

interface PreviewViewProps {
  content: string;
  annotations: Annotation[];
  onAnnotationAdd: (lineStart: number, lineEnd: number, selectedText: string) => void;
  onAnnotationDelete: (id: string) => void;
}

export function PreviewView({ content, annotations, onAnnotationAdd, onAnnotationDelete }: PreviewViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; lineStart: number; lineEnd: number } | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelection(null); return; }
    const selectedText = sel.toString().trim();
    if (!selectedText) { setSelection(null); return; }
    const firstLine = content.indexOf(selectedText.split('\n')[0]);
    if (firstLine === -1) { setSelection(null); return; }
    const lineStart = content.slice(0, firstLine).split('\n').length;
    const lineEnd = lineStart + selectedText.split('\n').length - 1;
    setSelection({ text: selectedText, lineStart, lineEnd });
  }, [content]);

  const handleAddFromSelection = useCallback(() => {
    if (!selection) return;
    onAnnotationAdd(selection.lineStart, selection.lineEnd, selection.text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [selection, onAnnotationAdd]);

  const html = renderMarkdown(content);

  return (
    <div className={styles.previewView}>
      {selection && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionInfo}>Selected: lines {selection.lineStart}–{selection.lineEnd}</span>
          <button className={styles.selectionAddBtn} onClick={handleAddFromSelection}>+ Add annotation</button>
          <button className={styles.selectionCancelBtn} onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}>✕</button>
        </div>
      )}
      <div ref={containerRef} className={styles.previewContent} onMouseUp={handleMouseUp} dangerouslySetInnerHTML={{ __html: html }} />
      {annotations.length > 0 && (
        <div className={styles.previewAnnotations}>
          <div className={styles.previewAnnotationsTitle}>Annotations</div>
          {annotations.map((a) => (
            <div key={a.id} className={styles.previewAnnotBlock}>
              <div className={styles.annotMeta}>
                <span className={styles.annotRange}>
                  {a.lineStart === a.lineEnd ? `Line ${a.lineStart}` : `Lines ${a.lineStart}–${a.lineEnd}`}
                </span>
                <button className={styles.annotDelete} onClick={() => onAnnotationDelete(a.id)} title="Delete">✕</button>
              </div>
              {a.selectedText && (
                <pre className={styles.annotQuote}>
                  {a.selectedText.length > 150 ? a.selectedText.slice(0, 150) + '…' : a.selectedText}
                </pre>
              )}
              <div className={styles.annotComment}>{a.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── File loader ───────────────────────────────────────────────────────────────

interface FileLoaderProps {
  onLoad: (content: string, filename: string, sourceUrl: string | null) => void;
}

export function FileLoader({ onLoad }: FileLoaderProps) {
  const [urlInput, setUrlInput] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [pasteFilename, setPasteFilename] = useState('');
  const [tab, setTab] = useState<'url' | 'paste'>('url');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFromGithub = async () => {
    setError(null);
    const parsed = parseGithubUrl(urlInput.trim());
    if (!parsed) { setError('Invalid GitHub URL. Expected: github.com/owner/repo/blob/branch/path/to/file'); return; }
    setLoading(true);
    try {
      const res = await fetch(parsed.rawUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const filename = parsed.rawUrl.split('/').pop() ?? 'file';
      onLoad(text, filename, parsed.displayUrl);
    } catch (e) {
      setError(`Failed to fetch: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  };

  const loadPasted = () => {
    if (!pasteContent.trim()) { setError('No content to load.'); return; }
    onLoad(pasteContent, pasteFilename.trim() || 'untitled.md', null);
  };

  return (
    <div className={styles.loader}>
      <div className={styles.loaderTabs}>
        <button className={`${styles.loaderTab} ${tab === 'url' ? styles.loaderTabActive : ''}`} onClick={() => setTab('url')}>GitHub URL</button>
        <button className={`${styles.loaderTab} ${tab === 'paste' ? styles.loaderTabActive : ''}`} onClick={() => setTab('paste')}>Paste content</button>
      </div>

      {tab === 'url' && (
        <div className={styles.loaderSection}>
          <p className={styles.loaderDesc}>Paste a GitHub file URL to load and review it.</p>
          <div className={styles.loaderRow}>
            <input
              className={styles.loaderInput}
              type="url"
              placeholder="https://github.com/owner/repo/blob/main/README.md"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchFromGithub(); }}
            />
            <button className={styles.loaderBtn} onClick={fetchFromGithub} disabled={loading || !urlInput.trim()}>
              {loading ? 'Loading…' : 'Fetch'}
            </button>
          </div>
        </div>
      )}

      {tab === 'paste' && (
        <div className={styles.loaderSection}>
          <div className={styles.loaderRow}>
            <input
              className={styles.loaderFilenameInput}
              type="text"
              placeholder="filename.md"
              value={pasteFilename}
              onChange={(e) => setPasteFilename(e.target.value)}
            />
          </div>
          <textarea
            className={styles.loaderTextarea}
            placeholder="Paste file contents here…"
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={12}
          />
          <button className={styles.loaderBtn} onClick={loadPasted} disabled={!pasteContent.trim()}>Load file</button>
        </div>
      )}

      {error && <div className={styles.loaderError}>{error}</div>}
    </div>
  );
}

// ── Review panel ──────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  content: string;
  filename: string;
  sourceUrl: string | null;
  annotations: Annotation[];
  onBack: () => void;
}

export function ReviewPanel({ content, filename, sourceUrl, annotations, onBack }: ReviewPanelProps) {
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);

  const prompt = buildReviewPrompt({ content, filename, sourceUrl, annotations, summary });
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const chatgptUrl = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.reviewPanel}>
      <div className={styles.reviewPanelHeader}>
        <span className={styles.reviewPanelTitle}>Finish Review</span>
      </div>
      <div className={styles.reviewStats}>
        <span className={styles.reviewStat}>{annotations.length} annotation{annotations.length !== 1 ? 's' : ''}</span>
        <span className={styles.reviewStat}>{content.split('\n').length} lines</span>
        {sourceUrl && (
          <a className={styles.reviewSourceLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">View source</a>
        )}
      </div>
      <div className={styles.reviewSummarySection}>
        <label className={styles.reviewLabel}>Summary (optional)</label>
        <textarea
          className={styles.reviewSummary}
          placeholder="Add overall review notes, context, or questions…"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
        />
      </div>
      <div className={styles.reviewActions}>
        <button className={styles.reviewCopyBtn} onClick={handleCopy}>{copied ? '✓ Copied!' : 'Copy prompt'}</button>
        <a className={styles.reviewOpenClaude} href={claudeUrl} target="_blank" rel="noopener noreferrer">Open in Claude</a>
        <a className={styles.reviewOpenChatgpt} href={chatgptUrl} target="_blank" rel="noopener noreferrer">Open in ChatGPT</a>
      </div>
      <div className={styles.reviewPromptPreview}>
        <div className={styles.reviewPromptHeader}><span className={styles.reviewPromptLabel}>Prompt preview</span></div>
        <pre className={styles.reviewPromptText}>{prompt}</pre>
      </div>
      <button className={styles.reviewNewBtn} onClick={onBack}>← Back to annotations</button>
    </div>
  );
}

// ── Embed panel ───────────────────────────────────────────────────────────────

const EMBED_BASE = 'https://treq.dev/tools/markdown-annotator-embed';
const CONTENT_SIZE_LIMIT = 60_000;

interface EmbedPanelProps {
  content: string;
  filename: string;
  sourceUrl: string | null;
  onClose: () => void;
}

function EmbedPanel({ content, filename, sourceUrl, onClose }: EmbedPanelProps) {
  const [width, setWidth] = useState(900);
  const [height, setHeight] = useState(650);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tooLarge = !sourceUrl && content.length > CONTENT_SIZE_LIMIT;

  const embedUrl = sourceUrl
    ? `${EMBED_BASE}?url=${encodeURIComponent(sourceUrl)}`
    : tooLarge
    ? null
    : `${EMBED_BASE}?content=${encodeContentForUrl(content)}&filename=${encodeURIComponent(filename)}`;

  const iframeCode = embedUrl
    ? `<iframe\n  src="${embedUrl}"\n  width="${width}"\n  height="${height}"\n  frameborder="0"\n  style="border-radius:8px;border:1px solid #e5e7eb;"\n></iframe>`
    : null;

  const handleCopy = async () => {
    if (!iframeCode) return;
    await navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInputClick = () => { inputRef.current?.select(); };

  return (
    <div className={styles.embedPanel}>
      <div className={styles.embedPanelHeader}>
        <div className={styles.embedPanelTitleRow}>
          <span className={styles.embedPanelTitle}>Embed this file</span>
          <button className={styles.embedPanelClose} onClick={onClose}>✕</button>
        </div>
        <p className={styles.embedPanelDesc}>
          Copy the code below and paste it into any HTML page to embed this file annotator.
        </p>
      </div>

      {tooLarge && (
        <div className={styles.embedWarning}>
          Content is too large to encode in a URL ({(content.length / 1024).toFixed(0)} KB). Use a GitHub URL to enable embedding.
        </div>
      )}

      {!tooLarge && embedUrl && (
        <>
          <div className={styles.embedSizeRow}>
            <label className={styles.embedSizeLabel}>
              Width
              <input
                className={styles.embedSizeInput}
                type="number"
                value={width}
                min={320}
                max={2560}
                onChange={(e) => setWidth(Math.max(320, Number(e.target.value)))}
              />
              <span className={styles.embedSizeUnit}>px</span>
            </label>
            <span className={styles.embedSizeSep}>×</span>
            <label className={styles.embedSizeLabel}>
              Height
              <input
                className={styles.embedSizeInput}
                type="number"
                value={height}
                min={300}
                max={2000}
                onChange={(e) => setHeight(Math.max(300, Number(e.target.value)))}
              />
              <span className={styles.embedSizeUnit}>px</span>
            </label>
          </div>

          <div className={styles.embedCodeSection}>
            <div className={styles.embedCodeLabel}>Embed code</div>
            <div className={styles.embedCodeRow}>
              <input
                ref={inputRef}
                className={styles.embedCodeInput}
                type="text"
                readOnly
                value={iframeCode ?? ''}
                onClick={handleInputClick}
              />
              <button className={styles.embedCopyBtn} onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className={styles.embedPreviewRow}>
            <a
              className={styles.embedPreviewLink}
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview embed ↗
            </a>
          </div>

          <div className={styles.embedInstructions}>
            <div className={styles.embedInstructionsTitle}>How to embed</div>
            <ol className={styles.embedInstructionsList}>
              <li>Copy the embed code above.</li>
              <li>Paste it into any HTML page where you want the annotator to appear.</li>
              <li>Adjust <code>width</code> and <code>height</code> to fit your layout. You can also use <code>width="100%"</code>.</li>
              <li>Viewers can annotate the file and export their review to Claude or ChatGPT directly from the embed.</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

// ── Annotator tool ────────────────────────────────────────────────────────────

interface InitialFileState {
  content: string;
  filename: string;
  sourceUrl: string | null;
}

interface AnnotatorToolProps {
  compact?: boolean;
  initialFile?: InitialFileState;
}

export function AnnotatorTool({ compact = false, initialFile }: AnnotatorToolProps) {
  const [content, setContent] = useState<string | null>(initialFile?.content ?? null);
  const [filename, setFilename] = useState(initialFile?.filename ?? '');
  const [sourceUrl, setSourceUrl] = useState<string | null>(initialFile?.sourceUrl ?? null);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    initialFile ? (isMarkdown(initialFile.filename) ? 'preview' : 'code') : 'code'
  );
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ lineStart: number; lineEnd: number; selectedText: string } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  const lines = content?.split('\n') ?? [];
  const isMd = isMarkdown(filename);

  const handleLoad = useCallback((c: string, fn: string, url: string | null) => {
    setContent(c);
    setFilename(fn);
    setSourceUrl(url);
    setAnnotations([]);
    setViewMode(isMarkdown(fn) ? 'preview' : 'code');
    setShowReview(false);
    setShowEmbed(false);
  }, []);

  const handleAnnotationAdd = useCallback((lineStart: number, lineEnd: number, selectedText: string) => {
    setPendingAnnotation({ lineStart, lineEnd, selectedText });
  }, []);

  const handleAnnotationConfirm = useCallback((comment: string) => {
    if (!pendingAnnotation) return;
    setAnnotations((prev) => [...prev, { id: uid(), ...pendingAnnotation, comment, view: viewMode }]);
    setPendingAnnotation(null);
  }, [pendingAnnotation, viewMode]);

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    if (compact) return;
    setContent(null);
    setFilename('');
    setSourceUrl(null);
    setAnnotations([]);
    setPendingAnnotation(null);
    setShowReview(false);
    setShowEmbed(false);
  }, [compact]);

  if (!content) {
    return (
      <div className={styles.toolRoot}>
        <div className={styles.toolHeader}>
          {!compact && (
            <div className={styles.breadcrumb}>
              <a href="/tools">Tools</a>
              <span> / </span>
              <span>Markdown Annotator</span>
            </div>
          )}
          <h1 className={styles.toolTitle}>Markdown Annotator</h1>
          <p className={styles.toolSubtitle}>
            Annotate markdown and code files like a PR review. Add inline comments, then export a review prompt for Claude or ChatGPT.
          </p>
        </div>
        <FileLoader onLoad={handleLoad} />
      </div>
    );
  }

  if (showReview) {
    return (
      <div className={styles.toolRoot}>
        <div className={styles.toolHeader}>
          {!compact && (
            <div className={styles.breadcrumb}>
              <a href="/tools">Tools</a>
              <span> / </span>
              <button className={styles.breadcrumbBtn} onClick={() => setShowReview(false)}>Markdown Annotator</button>
              <span> / </span>
              <span>Review</span>
            </div>
          )}
          <h1 className={styles.toolTitle}>Review: {filename}</h1>
        </div>
        <ReviewPanel
          content={content}
          filename={filename}
          sourceUrl={sourceUrl}
          annotations={annotations}
          onBack={() => setShowReview(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.toolRoot}>
      <div className={styles.toolHeader}>
        {!compact && (
          <div className={styles.breadcrumb}>
            <a href="/tools">Tools</a>
            <span> / </span>
            <span>Markdown Annotator</span>
          </div>
        )}
        <div className={styles.toolTitleRow}>
          <h1 className={compact ? styles.toolTitleCompact : styles.toolTitle}>{filename}</h1>
          <div className={styles.toolHeaderActions}>
            {isMd && (
              <div className={styles.viewToggle}>
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'code' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('code')}
                >Code</button>
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'preview' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('preview')}
                >Preview</button>
              </div>
            )}
            {!compact && (
              <>
                <button
                  className={`${styles.embedToggleBtn} ${showEmbed ? styles.embedToggleBtnActive : ''}`}
                  onClick={() => setShowEmbed((v) => !v)}
                >
                  {showEmbed ? 'Hide embed' : '‹/› Embed'}
                </button>
                <button className={styles.changeFileBtn} onClick={handleClear}>Change file</button>
              </>
            )}
            <button className={styles.finishReviewBtn} onClick={() => setShowReview(true)}>
              Finish review ({annotations.length})
            </button>
          </div>
        </div>
        {sourceUrl && (
          <div className={styles.sourceUrlBar}>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.sourceUrlLink}>{sourceUrl}</a>
          </div>
        )}
      </div>

      {showEmbed && !compact && (
        <EmbedPanel content={content} filename={filename} sourceUrl={sourceUrl} onClose={() => setShowEmbed(false)} />
      )}

      <div className={styles.toolBody}>
        {viewMode === 'code' ? (
          <CodeView lines={lines} annotations={annotations} onAnnotationAdd={handleAnnotationAdd} onAnnotationDelete={handleAnnotationDelete} />
        ) : (
          <PreviewView content={content} annotations={annotations} onAnnotationAdd={handleAnnotationAdd} onAnnotationDelete={handleAnnotationDelete} />
        )}
      </div>

      {pendingAnnotation && (
        <AnnotationDialog
          lineStart={pendingAnnotation.lineStart}
          lineEnd={pendingAnnotation.lineEnd}
          selectedText={pendingAnnotation.selectedText}
          view={viewMode}
          onConfirm={handleAnnotationConfirm}
          onCancel={() => setPendingAnnotation(null)}
        />
      )}
    </div>
  );
}
