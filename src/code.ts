const CODEX_ENDPOINT = 'http://127.0.0.1:5000/ask';

let conversationId: string | undefined;

figma.showUI(__html__, { width: 420, height: 520 });

figma.ui.onmessage = async (
  msg: {
    type: 'userQuery';
    text: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  },
) => {
  if (msg.type !== 'userQuery') return;

  const designContext = buildDesignContext();
  const body = buildRequestBody(msg.text, designContext);

  try {
    const response = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(async () => ({
      error: {
        code: 'INVALID_RESPONSE',
        message: await safeReadText(response),
      },
    }));

    if (!response.ok) {
      const errorMessage = extractErrorMessage(payload);
      throw new Error(errorMessage);
    }

    conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : conversationId;
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';

    figma.ui.postMessage({ type: 'codexResponse', text: content });
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Codexサーバーへのリクエストに失敗しました。';

    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      message =
        'CORSエラー: サーバーに接続できません。サーバーが起動しているか、Access-Control-Allow-Origin ヘッダーが設定されているか確認してください。';
    }

    if (error instanceof Error && error.message.includes('CORS')) {
      message = error.message;
    }

    figma.ui.postMessage({
      type: 'error',
      text: `⚠️ ${message}`,
    });
  }
};

function buildRequestBody(userInput: string, designContext: string) {
  return {
    tool: 'codex',
    model: 'codex:local',
    userInput,
    designContext,
    conversationId,
  };
}


function buildDesignContext(): string {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    return describePage(figma.currentPage);
  }

  const lines: string[] = [`選択中の${selection.length}件:`];
  for (const node of selection) {
    lines.push(describeNode(node));

    if (hasChildren(node)) {
      const children = node.children.slice(0, 5);
      for (const child of children) {
        lines.push(`  - ${describeNode(child)}`);
      }

      if (node.children.length > 5) {
        lines.push('  - ...');
      }
    }
  }

  return lines.join('\n');
}

function describePage(page: PageNode): string {
  const lines: string[] = [`ページ「${page.name}」: レイヤー ${page.children.length} 件`];
  const previewNodes = page.children.slice(0, 10);

  for (const node of previewNodes) {
    lines.push(`- ${describeNode(node)}`);
  }

  if (page.children.length > previewNodes.length) {
    lines.push(`- ... (${page.children.length - previewNodes.length} 件省略)`);
  }

  return lines.join('\n');
}

function describeNode(node: SceneNode): string {
  const base = `${node.type}「${node.name}」`;
  const size = 'width' in node && 'height' in node ? ` ${Math.round(node.width)}×${Math.round(node.height)}` : '';
  const fills = getFillDescription(node);
  const typography = getTypographyDescription(node);

  return [base, size, fills, typography].filter(Boolean).join(' ');
}

function getFillDescription(node: SceneNode): string | null {
  if (!hasFills(node)) return null;
  const paints = node.fills;
  if (!Array.isArray(paints) || paints.length === 0) return null;

  const [paint] = paints;
  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color;
    const hex = rgbToHex(r, g, b);
    const opacity = paint.opacity ?? 1;
    const opacityText = opacity < 1 ? ` (opacity ${Math.round(opacity * 100)}%)` : '';
    return `塗り:${hex}${opacityText}`;
  }

  if (paint.type === 'GRADIENT_LINEAR') {
    return '線形グラデーション';
  }

  if (typeof paint.type === 'string') {
    return paint.type.toLowerCase().replace(/_/g, ' ');
  }

  return '複合塗り';
}

function getTypographyDescription(node: SceneNode): string | null {
  if (node.type !== 'TEXT') return null;
  const rawText = node.characters.trim();
  const characters = rawText.length > 20 ? `${rawText.slice(0, 20)}…` : rawText;
  const fontSize = typeof node.fontSize === 'number' ? `${Math.round(node.fontSize)}px` : '';
  return `テキスト「${characters || '（空文字）'}」${fontSize}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.error('Failed to read response text', error);
    return '';
  }
}

function extractErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof (payload.error as { message: unknown }).message === 'string'
  ) {
    return (payload.error as { message: string }).message;
  }
  return 'Codexサーバーでエラーが発生しました。';
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node;
}

function hasFills(node: SceneNode): node is SceneNode & GeometryMixin {
  return 'fills' in node;
}
