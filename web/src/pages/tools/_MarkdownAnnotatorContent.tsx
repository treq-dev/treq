import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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

interface MdBlock {
  lineStart: number;
  lineEnd: number;
  html: string;
}

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

// ── Markdown block renderer ───────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFmt(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// Returns an array of blocks each with a source line range and rendered HTML.
function renderMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const rawLines = md.split('\n');
  let i = 0;

  while (i < rawLines.length) {
    const raw = rawLines[i];
    const lineNum = i + 1;

    // Skip blank lines — they don't produce a block
    if (!raw.trim()) { i++; continue; }

    // Fenced code block
    if (raw.trimStart().startsWith('```')) {
      const start = i;
      const lang = raw.replace(/^\s*```/, '').trim();
      i++;
      const codeLines: string[] = [];
      while (i < rawLines.length && !rawLines[i].trimStart().startsWith('```')) {
        codeLines.push(esc(rawLines[i]));
        i++;
      }
      i++; // closing ```
      blocks.push({
        lineStart: start + 1,
        lineEnd: i,
        html: `<pre><code class="language-${lang || 'text'}">${codeLines.join('\n')}</code></pre>`,
      });
      continue;
    }

    // ATX heading
    const hMatch = raw.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push({ lineStart: lineNum, lineEnd: lineNum, html: `<h${level}>${inlineFmt(esc(hMatch[2]))}</h${level}>` });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(raw)) {
      blocks.push({ lineStart: lineNum, lineEnd: lineNum, html: '<hr/>' });
      i++;
      continue;
    }

    // Blockquote — collect consecutive > lines
    if (raw.startsWith('>')) {
      const start = i;
      const innerLines: string[] = [];
      while (i < rawLines.length && rawLines[i].startsWith('>')) {
        innerLines.push(inlineFmt(esc(rawLines[i].replace(/^>\s?/, ''))));
        i++;
      }
      blocks.push({
        lineStart: start + 1,
        lineEnd: i,
        html: `<blockquote>${innerLines.map((l) => `<p>${l}</p>`).join('')}</blockquote>`,
      });
      continue;
    }

    // Unordered list — collect consecutive list items (simple flat list)
    if (/^[-*+]\s/.test(raw)) {
      const start = i;
      const items: string[] = [];
      while (i < rawLines.length && /^[-*+]\s/.test(rawLines[i])) {
        items.push(`<li>${inlineFmt(esc(rawLines[i].replace(/^[-*+]\s/, '')))}</li>`);
        i++;
      }
      blocks.push({ lineStart: start + 1, lineEnd: i, html: `<ul>${items.join('')}</ul>` });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(raw)) {
      const start = i;
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s/.test(rawLines[i])) {
        items.push(`<li>${inlineFmt(esc(rawLines[i].replace(/^\d+\.\s/, '')))}</li>`);
        i++;
      }
      blocks.push({ lineStart: start + 1, lineEnd: i, html: `<ol>${items.join('')}</ol>` });
      continue;
    }

    // Paragraph — collect consecutive non-special, non-blank lines
    const start = i;
    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(rawLines[i]) &&
      !rawLines[i].trimStart().startsWith('```') &&
      !/^[-*_]{3,}\s*$/.test(rawLines[i]) &&
      !rawLines[i].startsWith('>') &&
      !/^[-*+]\s/.test(rawLines[i]) &&
      !/^\d+\.\s/.test(rawLines[i])
    ) {
      paraLines.push(inlineFmt(esc(rawLines[i])));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ lineStart: start + 1, lineEnd: i, html: `<p>${paraLines.join('<br/>')}</p>` });
    }
  }

  return blocks;
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
  const out: string[] = [];

  out.push('# File Review');
  out.push('');

  if (sourceUrl) {
    out.push(`**File:** \`${filename}\``);
    out.push(`**Source:** ${sourceUrl}`);
    out.push('');
  }

  if (annotations.length > 0) {
    out.push('## Inline Annotations');
    out.push('');
    for (const a of annotations) {
      const range = a.lineStart === a.lineEnd ? `Line ${a.lineStart}` : `Lines ${a.lineStart}–${a.lineEnd}`;
      out.push(`### ${range}`);
      if (a.selectedText) { out.push(''); out.push('```'); out.push(a.selectedText); out.push('```'); }
      out.push(''); out.push(a.comment); out.push('');
    }
  }

  if (summary.trim()) { out.push('## Summary'); out.push(''); out.push(summary.trim()); out.push(''); }

  out.push('## File Contents');
  out.push('');
  out.push('```' + (sourceUrl ? detectLanguage(filename) : 'text'));
  out.push(content);
  out.push('```');

  return out.join('\n');
}

// ── Inline comment form ───────────────────────────────────────────────────────

interface InlineFormProps {
  lineStart: number;
  lineEnd: number;
  comment: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function InlineForm({ lineStart, lineEnd, comment, onChange, onSubmit, onCancel }: InlineFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const range = lineStart === lineEnd ? `Line ${lineStart}` : `Lines ${lineStart}–${lineEnd}`;

  return (
    <div className={styles.inlineForm}>
      <div className={styles.inlineFormRange}>{range}</div>
      <textarea
        ref={textareaRef}
        className={styles.inlineFormTextarea}
        placeholder="Leave a comment… (⌘↵ to submit)"
        value={comment}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (comment.trim()) onSubmit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className={styles.inlineFormActions}>
        <button className={styles.inlineFormCancel} onClick={onCancel}>Cancel</button>
        <button className={styles.inlineFormSubmit} disabled={!comment.trim()} onClick={onSubmit}>
          Add comment
        </button>
      </div>
    </div>
  );
}

// ── Annotation card ───────────────────────────────────────────────────────────

interface AnnotCardProps {
  annotation: Annotation;
  onDelete: (id: string) => void;
}

function AnnotCard({ annotation: a, onDelete }: AnnotCardProps) {
  const range = a.lineStart === a.lineEnd ? `Line ${a.lineStart}` : `Lines ${a.lineStart}–${a.lineEnd}`;
  return (
    <div className={styles.annotCard}>
      <div className={styles.annotCardHeader}>
        <span className={styles.annotCardRange}>{range}</span>
        <button className={styles.annotCardDelete} onClick={() => onDelete(a.id)} title="Delete comment">✕</button>
      </div>
      {a.selectedText && (
        <pre className={styles.annotCardQuote}>
          {a.selectedText.length > 160 ? a.selectedText.slice(0, 160) + '…' : a.selectedText}
        </pre>
      )}
      <div className={styles.annotCardComment}>{a.comment}</div>
    </div>
  );
}

// ── Code view ─────────────────────────────────────────────────────────────────

interface CodeViewProps {
  lines: string[];
  annotations: Annotation[];
  onAnnotationAdd: (lineStart: number, lineEnd: number, selectedText: string, comment: string) => void;
  onAnnotationDelete: (id: string) => void;
}

export function CodeView({ lines, annotations, onAnnotationAdd, onAnnotationDelete }: CodeViewProps) {
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [inlineForm, setInlineForm] = useState<{ lineStart: number; lineEnd: number } | null>(null);
  const [inlineComment, setInlineComment] = useState('');

  const getRange = (a: number, b: number): [number, number] =>
    a <= b ? [a, b] : [b, a];

  const handleAddClick = (lineNum: number) => {
    if (anchorLine !== null && anchorLine !== lineNum) {
      const [start, end] = getRange(anchorLine, lineNum);
      setInlineForm({ lineStart: start, lineEnd: end });
    } else {
      setInlineForm({ lineStart: lineNum, lineEnd: lineNum });
    }
    setAnchorLine(null);
    setInlineComment('');
  };

  const handleLineNumClick = (lineNum: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (inlineForm) return;
    setAnchorLine((prev) => (prev === lineNum ? null : lineNum));
  };

  const handleInlineSubmit = () => {
    if (!inlineForm || !inlineComment.trim()) return;
    const selectedText = lines.slice(inlineForm.lineStart - 1, inlineForm.lineEnd).join('\n');
    onAnnotationAdd(inlineForm.lineStart, inlineForm.lineEnd, selectedText, inlineComment.trim());
    setInlineForm(null);
    setInlineComment('');
  };

  const handleInlineCancel = () => {
    setInlineForm(null);
    setInlineComment('');
  };

  const [rangeStart, rangeEnd] =
    anchorLine !== null && hoverLine !== null ? getRange(anchorLine, hoverLine) : [null, null];

  // Build a map: lineNum → annotations starting here
  const annotsByLine = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const arr = annotsByLine.get(a.lineStart) ?? [];
    arr.push(a);
    annotsByLine.set(a.lineStart, arr);
  }

  // Lines that are annotated (for gutter dot)
  const annotatedLines = new Set(annotations.flatMap((a) => {
    const out: number[] = [];
    for (let l = a.lineStart; l <= a.lineEnd; l++) out.push(l);
    return out;
  }));

  return (
    <div className={styles.codeView}>
      <div className={styles.codeScroll}>
        <table className={styles.codeTable} cellSpacing={0} cellPadding={0}>
          <tbody>
            {lines.map((lineContent, idx) => {
              const lineNum = idx + 1;
              const isInRange = rangeStart !== null && rangeEnd !== null && lineNum >= rangeStart && lineNum <= rangeEnd;
              const isAnchor = lineNum === anchorLine;
              const isAnnotated = annotatedLines.has(lineNum);
              const annotsHere = annotsByLine.get(lineNum) ?? [];
              const isFormEnd = inlineForm?.lineEnd === lineNum;
              const isFormRange = inlineForm !== null && lineNum >= inlineForm.lineStart && lineNum <= inlineForm.lineEnd;

              return (
                <React.Fragment key={lineNum}>
                  <tr
                    className={`${styles.codeLine} ${isInRange || isAnchor ? styles.codeLineSelected : ''} ${isAnnotated ? styles.codeLineAnnotated : ''} ${isFormRange ? styles.codeLineFormRange : ''}`}
                    onMouseEnter={() => setHoverLine(lineNum)}
                    onMouseLeave={() => setHoverLine(null)}
                  >
                    {/* Add-comment button — left of gutter */}
                    <td className={styles.addCell}>
                      <button
                        className={`${styles.addBtn} ${isAnchor ? styles.addBtnAnchor : ''}`}
                        onClick={() => handleAddClick(lineNum)}
                        title={anchorLine !== null && anchorLine !== lineNum ? `Comment on lines ${Math.min(anchorLine, lineNum)}–${Math.max(anchorLine, lineNum)}` : 'Add comment'}
                        tabIndex={-1}
                      >
                        +
                      </button>
                    </td>

                    {/* Line number */}
                    <td
                      className={`${styles.lineNum} ${isAnchor ? styles.lineNumAnchor : ''}`}
                      onClick={(e) => handleLineNumClick(lineNum, e)}
                      title="Click to start a range selection, click another line number to extend"
                    >
                      {isAnnotated && <span className={styles.annotDot} />}
                      {lineNum}
                    </td>

                    {/* Code content */}
                    <td className={styles.lineContent}>
                      <pre className={styles.lineCode}>{lineContent || ' '}</pre>
                    </td>
                  </tr>

                  {/* Inline comment form — appears after the last line of the range */}
                  {isFormEnd && (
                    <tr className={styles.inlineFormRow}>
                      <td />
                      <td />
                      <td className={styles.inlineFormCell}>
                        <InlineForm
                          lineStart={inlineForm.lineStart}
                          lineEnd={inlineForm.lineEnd}
                          comment={inlineComment}
                          onChange={setInlineComment}
                          onSubmit={handleInlineSubmit}
                          onCancel={handleInlineCancel}
                        />
                      </td>
                    </tr>
                  )}

                  {/* Existing annotation cards */}
                  {annotsHere.map((a) => (
                    <tr key={a.id} className={styles.annotCardRow}>
                      <td />
                      <td />
                      <td className={styles.annotCardCell}>
                        <AnnotCard annotation={a} onDelete={onAnnotationDelete} />
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {anchorLine !== null && (
        <div className={styles.codeRangeHint}>
          Line {anchorLine} anchored — click another "+" to comment on a range, or click the same line number to deselect
        </div>
      )}
    </div>
  );
}

// ── Preview view ──────────────────────────────────────────────────────────────

interface PreviewViewProps {
  content: string;
  annotations: Annotation[];
  onAnnotationAdd: (lineStart: number, lineEnd: number, selectedText: string, comment: string) => void;
  onAnnotationDelete: (id: string) => void;
}

export function PreviewView({ content, annotations, onAnnotationAdd, onAnnotationDelete }: PreviewViewProps) {
  const blocks = useMemo(() => renderMarkdownBlocks(content), [content]);
  const rawLines = content.split('\n');

  const [inlineForm, setInlineForm] = useState<{ blockIdx: number; lineStart: number; lineEnd: number } | null>(null);
  const [inlineComment, setInlineComment] = useState('');

  const handleAddClick = (block: MdBlock, blockIdx: number) => {
    setInlineForm({ blockIdx, lineStart: block.lineStart, lineEnd: block.lineEnd });
    setInlineComment('');
  };

  const handleInlineSubmit = () => {
    if (!inlineForm || !inlineComment.trim()) return;
    const selectedText = rawLines.slice(inlineForm.lineStart - 1, inlineForm.lineEnd).join('\n');
    onAnnotationAdd(inlineForm.lineStart, inlineForm.lineEnd, selectedText, inlineComment.trim());
    setInlineForm(null);
    setInlineComment('');
  };

  // Map lineStart → annotations
  const annotsByLine = new Map<number, Annotation[]>();
  for (const a of annotations) {
    const arr = annotsByLine.get(a.lineStart) ?? [];
    arr.push(a);
    annotsByLine.set(a.lineStart, arr);
  }

  return (
    <div className={styles.previewView}>
      {blocks.map((block, blockIdx) => {
        const annotsHere = annotsByLine.get(block.lineStart) ?? [];
        const isFormHere = inlineForm?.blockIdx === blockIdx;

        return (
          <React.Fragment key={blockIdx}>
            {/* Block row with line number + rendered content */}
            <div className={`${styles.previewBlockRow} ${isFormHere ? styles.previewBlockRowActive : ''}`}>
              {/* Add button */}
              <button
                className={styles.previewAddBtn}
                onClick={() => handleAddClick(block, blockIdx)}
                title="Add annotation"
                tabIndex={-1}
              >
                +
              </button>
              {/* Line number */}
              <div className={styles.previewLineNum}>
                {block.lineStart}
                {block.lineEnd > block.lineStart && (
                  <span className={styles.previewLineNumEnd}>–{block.lineEnd}</span>
                )}
              </div>
              {/* Rendered content */}
              <div
                className={styles.previewBlockContent}
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            </div>

            {/* Inline form */}
            {isFormHere && (
              <div className={styles.previewInlineFormRow}>
                <div className={styles.previewInlineFormSpacer} />
                <div className={styles.previewInlineFormContent}>
                  <InlineForm
                    lineStart={inlineForm.lineStart}
                    lineEnd={inlineForm.lineEnd}
                    comment={inlineComment}
                    onChange={setInlineComment}
                    onSubmit={handleInlineSubmit}
                    onCancel={() => { setInlineForm(null); setInlineComment(''); }}
                  />
                </div>
              </div>
            )}

            {/* Annotation cards */}
            {annotsHere.map((a) => (
              <div key={a.id} className={styles.previewAnnotRow}>
                <div className={styles.previewInlineFormSpacer} />
                <div className={styles.previewAnnotContent}>
                  <AnnotCard annotation={a} onDelete={onAnnotationDelete} />
                </div>
              </div>
            ))}
          </React.Fragment>
        );
      })}
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFromGithub = async () => {
    if (!urlInput.trim()) return;
    setError(null);
    const parsed = parseGithubUrl(urlInput.trim());
    if (!parsed) {
      setError('Invalid GitHub URL. Expected: github.com/owner/repo/blob/branch/path/to/file');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(parsed.rawUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const filename = parsed.rawUrl.split('/').pop() ?? 'file';
      onLoad(text, filename, parsed.displayUrl);
    } catch (e) {
      setError(`Failed to fetch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadPasted = () => {
    if (!pasteContent.trim()) { setError('No content to load.'); return; }
    onLoad(pasteContent, '', null);
  };

  return (
    <div className={styles.loader}>
      {/* GitHub URL */}
      <div className={styles.loaderSection}>
        <label className={styles.loaderLabel}>GitHub file URL</label>
        <div className={styles.loaderRow}>
          <input
            className={styles.loaderInput}
            type="url"
            placeholder="https://github.com/owner/repo/blob/main/README.md"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchFromGithub(); }}
          />
          <button className={styles.loaderBtn} onClick={fetchFromGithub} disabled={loading || !urlInput.trim()}>
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>
      </div>

      <div className={styles.loaderDivider}>
        <span>or paste content below</span>
      </div>

      {/* Paste */}
      <div className={styles.loaderSection}>
        <textarea
          className={styles.loaderTextarea}
          placeholder="Paste file contents here…"
          value={pasteContent}
          onChange={(e) => { setPasteContent(e.target.value); setError(null); }}
          rows={10}
        />
        <button
          className={styles.loaderBtn}
          onClick={loadPasted}
          disabled={!pasteContent.trim()}
          style={{ alignSelf: 'flex-start' }}
        >
          Load
        </button>
      </div>

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
    : `${EMBED_BASE}?content=${encodeContentForUrl(content)}&filename=${encodeURIComponent(filename || 'file')}`;

  const iframeCode = embedUrl
    ? `<iframe\n  src="${embedUrl}"\n  width="${width}"\n  height="${height}"\n  frameborder="0"\n  style="border-radius:8px;border:1px solid #e5e7eb;"\n></iframe>`
    : null;

  const handleCopy = async () => {
    if (!iframeCode) return;
    await navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
                onClick={() => inputRef.current?.select()}
              />
              <button className={styles.embedCopyBtn} onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className={styles.embedPreviewRow}>
            <a className={styles.embedPreviewLink} href={embedUrl} target="_blank" rel="noopener noreferrer">
              Preview embed ↗
            </a>
          </div>

          <div className={styles.embedInstructions}>
            <div className={styles.embedInstructionsTitle}>How to embed</div>
            <ol className={styles.embedInstructionsList}>
              <li>Copy the embed code above.</li>
              <li>Paste it into any HTML page where you want the annotator to appear.</li>
              <li>Adjust <code>width</code> and <code>height</code> to fit your layout — <code>width="100%"</code> works for responsive layouts.</li>
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

  const handleAnnotationAdd = useCallback(
    (lineStart: number, lineEnd: number, selectedText: string, comment: string) => {
      setAnnotations((prev) => [
        ...prev,
        { id: uid(), lineStart, lineEnd, selectedText, comment, view: viewMode },
      ]);
    },
    [viewMode]
  );

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    if (compact) return;
    setContent(null);
    setFilename('');
    setSourceUrl(null);
    setAnnotations([]);
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
          <h1 className={styles.toolTitle}>Review{filename ? `: ${filename}` : ''}</h1>
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
          <h1 className={compact ? styles.toolTitleCompact : styles.toolTitle}>
            {filename || 'Untitled'}
          </h1>
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
          <CodeView
            lines={lines}
            annotations={annotations}
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationDelete={handleAnnotationDelete}
          />
        ) : (
          <PreviewView
            content={content}
            annotations={annotations}
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationDelete={handleAnnotationDelete}
          />
        )}
      </div>
    </div>
  );
}
