import type { TreqSendMediaType } from "./treqSend";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageHighlightComment {
  id: string;
  rect: NormalizedRect;
  comment: string;
}

export interface AssetLineComment {
  id: string;
  startLine: number;
  endLine: number;
  lineContent: string[];
  text: string;
}

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const x = Math.min(Math.max(rect.x, 0), 1);
  const y = Math.min(Math.max(rect.y, 0), 1);
  const right = Math.min(Math.max(rect.x + rect.width, 0), 1);
  const bottom = Math.min(Math.max(rect.y + rect.height, 0), 1);
  return {
    x: roundNorm(Math.min(x, right)),
    y: roundNorm(Math.min(y, bottom)),
    width: roundNorm(Math.abs(right - x)),
    height: roundNorm(Math.abs(bottom - y)),
  };
}

function roundNorm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { width: number; height: number },
): NormalizedRect | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const x1 = start.x / bounds.width;
  const y1 = start.y / bounds.height;
  const x2 = end.x / bounds.width;
  const y2 = end.y / bounds.height;
  const rect = clampNormalizedRect({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
  if (rect.width < 0.01 && rect.height < 0.01) return null;
  return rect;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatHighlightLine(
  highlight: ImageHighlightComment,
  index: number,
): string {
  const { rect, comment } = highlight;
  const location = `${pct(rect.x)},${pct(rect.y)} ${pct(rect.width)}×${pct(rect.height)}`;
  const body = comment.trim() ? comment.trim() : "(no comment)";
  return `${index + 1}. Region ${location}: ${body}`;
}

function formatLineComment(
  comment: AssetLineComment,
  fileTitle: string,
): string {
  const lineRef =
    comment.startLine === comment.endLine
      ? `${fileTitle}:${comment.startLine}`
      : `${fileTitle}:${comment.startLine}:${comment.endLine}`;
  let block = `${lineRef}\n`;
  if (comment.lineContent.length > 0) {
    block += "```\n";
    block += `${comment.lineContent.join("\n")}\n`;
    block += "```\n";
  }
  block += `> ${comment.text.trim()}\n`;
  return block;
}

export function hasUnsentSendAssetReview(params: {
  generalComment: string;
  highlights: ImageHighlightComment[];
  lineComments: AssetLineComment[];
}): boolean {
  if (params.generalComment.trim()) return true;
  if (params.lineComments.some((comment) => comment.text.trim())) return true;
  return params.highlights.some(
    (highlight) =>
      highlight.comment.trim() ||
      highlight.rect.width > 0 ||
      highlight.rect.height > 0,
  );
}

export function formatSendAssetReviewPrompt(params: {
  title: string;
  path: string;
  mediaType: TreqSendMediaType;
  generalComment: string;
  highlights?: ImageHighlightComment[];
  lineComments?: AssetLineComment[];
  annotatedImagePath?: string | null;
}): string {
  const lines: string[] = [`Review of ${params.title}`];
  lines.push("");
  if (params.annotatedImagePath) {
    lines.push(
      `Annotated image with highlighted regions: ${params.annotatedImagePath}`,
    );
    lines.push("");
  } else {
    lines.push(`File: ${params.path}`);
    lines.push("");
  }

  const general = params.generalComment.trim();
  if (general) {
    lines.push(general);
    lines.push("");
  }

  const highlights = (params.highlights ?? []).filter(
    (highlight) => highlight.rect.width > 0 && highlight.rect.height > 0,
  );
  if (highlights.length > 0) {
    lines.push("Highlights:");
    highlights.forEach((highlight, index) => {
      lines.push(formatHighlightLine(highlight, index));
    });
    lines.push("");
  }

  const lineComments = (params.lineComments ?? []).filter((comment) =>
    comment.text.trim(),
  );
  if (lineComments.length > 0) {
    lines.push("Inline comments:");
    lines.push("");
    for (const comment of lineComments) {
      lines.push(formatLineComment(comment, params.title));
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

const HIGHLIGHT_STROKE = "#ef4444";

export async function renderHighlightedImageBlob(
  imageSrc: string,
  highlights: ImageHighlightComment[],
): Promise<Blob> {
  const image = await loadHtmlImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not draw highlighted image");
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = HIGHLIGHT_STROKE;
  ctx.lineWidth = Math.max(
    2,
    Math.round(Math.min(canvas.width, canvas.height) * 0.006),
  );
  for (const highlight of highlights) {
    const rect = clampNormalizedRect(highlight.rect);
    ctx.strokeRect(
      rect.x * canvas.width,
      rect.y * canvas.height,
      rect.width * canvas.width,
      rect.height * canvas.height,
    );
  }
  return canvasToBlob(canvas);
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const fail = () => reject(new Error("Failed to load image for highlight"));
    image.onload = () => resolve(image);
    image.onerror = fail;
    image.src = src;
    if (typeof image.decode === "function") {
      image
        .decode()
        .then(() => resolve(image))
        .catch(fail);
    }
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode highlighted image"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
