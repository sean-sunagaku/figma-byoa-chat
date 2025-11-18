import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type { EventHandler } from '@create-figma-plugin/utilities'
import type { SDK, SdkChangedPayload, SubmitQueryPayload, ComponentCreatedPayload } from './types'

const CODEX_ENDPOINT = 'http://127.0.0.1:5000/ask'

const EVENT_SUBMIT_QUERY = 'SUBMIT_QUERY'
const EVENT_SDK_CHANGED = 'SDK_CHANGED'
const EVENT_RESPONSE = 'CODEX_RESPONSE'
const EVENT_ERROR = 'PLUGIN_ERROR'
const EVENT_COMPONENT_CREATED = 'COMPONENT_CREATED'

let conversationId: string | undefined
let currentSdk: SDK = 'codex'

type SubmitQueryHandler = EventHandler & {
  name: typeof EVENT_SUBMIT_QUERY
  handler: (payload: SubmitQueryPayload) => void
}

type SdkChangedHandler = EventHandler & {
  name: typeof EVENT_SDK_CHANGED
  handler: (payload: SdkChangedPayload) => void
}

export default function () {
  showUI({ width: 420, height: 520 }, { initialSdk: currentSdk })

  on<SubmitQueryHandler>(EVENT_SUBMIT_QUERY, handleSubmitQuery)
  on<SdkChangedHandler>(EVENT_SDK_CHANGED, function ({ sdk }) {
    currentSdk = sdk
  })
}

async function handleSubmitQuery(payload: SubmitQueryPayload) {
  const text = payload.text?.trim()
  if (!text) {
    emit(EVENT_ERROR, { message: '⚠️ 質問内容を入力してください。' })
    return
  }

  const selectedSdk = payload.sdk ?? currentSdk
  currentSdk = selectedSdk

  const designContext = buildDesignContext()
  const requestBody = buildRequestBody(text, designContext, selectedSdk)

  try {
    const response = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    const payloadJson = await response.json().catch(async () => ({
      error: {
        code: 'INVALID_RESPONSE',
        message: await safeReadText(response)
      }
    }))

    if (!response.ok) {
      throw new Error(extractErrorMessage(payloadJson))
    }

    conversationId =
      typeof payloadJson.conversationId === 'string' ? payloadJson.conversationId : conversationId
    const content = typeof payloadJson.content === 'string' ? payloadJson.content.trim() : ''

    const { shouldCreateComponent } = parseCodexResponse(content)

    if (shouldCreateComponent) {
      const result = createComponentFromSelection()
      if (result) {
        const componentMessage = `✅ コンポーネント「${result.component.name}」を作成しました。\n\n${content}`
        emit(EVENT_RESPONSE, { text: componentMessage })
        emit(EVENT_COMPONENT_CREATED, {
          componentName: result.component.name,
          instanceCount: 1
        })
      } else {
        emit(EVENT_RESPONSE, {
          text: content.length > 0 ? content : '（応答がありません）'
        })
      }
    } else {
      emit(EVENT_RESPONSE, {
        text: content.length > 0 ? content : '（応答がありません）'
      })
    }
  } catch (error: unknown) {
    emit(EVENT_ERROR, {
      message: formatErrorMessage(error, selectedSdk)
    })
  }
}

function formatErrorMessage(error: unknown, sdk: SDK): string {
  const sdkName = sdk === 'claude' ? 'Claude' : 'Codex'

  if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
    return '⚠️ CORSエラー: サーバーに接続できません。Access-Control-Allow-Origin ヘッダーを確認してください。'
  }

  if (error instanceof Error) {
    if (error.message.includes('CORS')) {
      return `⚠️ ${error.message}`
    }
    return `⚠️ ${error.message}`
  }

  return `⚠️ ${sdkName}サーバーへのリクエストに失敗しました。`
}

function buildRequestBody(userInput: string, designContext: string, sdk: SDK = 'codex') {
  return {
    tool: sdk,
    model: sdk === 'claude' ? 'claude:pro' : 'codex:local',
    userInput,
    designContext,
    conversationId
  }
}

function buildDesignContext(): string {
  const selection = figma.currentPage.selection

  if (selection.length === 0) {
    return describePage(figma.currentPage)
  }

  const lines: Array<string> = [`選択中の${selection.length}件:`]
  for (const node of selection) {
    lines.push(describeNode(node))

    if (hasChildren(node)) {
      const children = node.children.slice(0, 5)
      for (const child of children) {
        lines.push(`  - ${describeNode(child)}`)
      }

      if (node.children.length > 5) {
        lines.push('  - ...')
      }
    }
  }

  return lines.join('\n')
}

function describePage(page: PageNode): string {
  const lines: Array<string> = [`ページ「${page.name}」: レイヤー ${page.children.length} 件`]
  const previewNodes = page.children.slice(0, 10)

  for (const node of previewNodes) {
    lines.push(`- ${describeNode(node)}`)
  }

  if (page.children.length > previewNodes.length) {
    lines.push(`- ... (${page.children.length - previewNodes.length} 件省略)`)
  }

  return lines.join('\n')
}

function describeNode(node: SceneNode): string {
  const base = `${node.type}「${node.name}」`
  const size = 'width' in node && 'height' in node ? ` ${Math.round(node.width)}×${Math.round(node.height)}` : ''
  const fills = getFillDescription(node)
  const typography = getTypographyDescription(node)

  return [base, size, fills, typography].filter(Boolean).join(' ')
}

function getFillDescription(node: SceneNode): string | null {
  if (!hasFills(node)) return null
  const paints = node.fills
  if (!Array.isArray(paints) || paints.length === 0) return null

  const [paint] = paints
  if (paint.type === 'SOLID') {
    const { r, g, b } = paint.color
    const hex = rgbToHex(r, g, b)
    const opacity = paint.opacity ?? 1
    const opacityText = opacity < 1 ? ` (opacity ${Math.round(opacity * 100)}%)` : ''
    return `塗り:${hex}${opacityText}`
  }

  if (paint.type === 'GRADIENT_LINEAR') {
    return '線形グラデーション'
  }

  if (typeof paint.type === 'string') {
    return paint.type.toLowerCase().replace(/_/g, ' ')
  }

  return '複合塗り'
}

function getTypographyDescription(node: SceneNode): string | null {
  if (node.type !== 'TEXT') return null
  const rawText = node.characters.trim()
  const characters = rawText.length > 20 ? `${rawText.slice(0, 20)}…` : rawText
  const fontSize = typeof node.fontSize === 'number' ? `${Math.round(node.fontSize)}px` : ''
  return `テキスト「${characters || '（空文字）'}」${fontSize}`
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    console.error('Failed to read response text', error)
    return ''
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
    return (payload.error as { message: string }).message
  }
  return 'Codexサーバーでエラーが発生しました。'
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

function hasFills(node: SceneNode): node is SceneNode & GeometryMixin {
  return 'fills' in node
}

function createComponentFromSelection(): { component: ComponentNode; instance: InstanceNode } | null {
  const selection = figma.currentPage.selection

  if (selection.length === 0) {
    emit(EVENT_ERROR, { message: '⚠️ レイヤーを選択してください。' })
    return null
  }

  try {
    const frame = figma.group(selection, figma.currentPage)
    const bounds = frame.absoluteBoundingBox

    if (!bounds) {
      frame.remove()
      emit(EVENT_ERROR, { message: '⚠️ 選択したレイヤーの境界を取得できませんでした。' })
      return null
    }

    const component = figma.createComponent()
    component.name = generateComponentName(selection)
    component.resize(bounds.width, bounds.height)

    for (const child of frame.children) {
      const clone = child.clone()
      component.appendChild(clone)
      if ('x' in child && 'y' in child) {
        clone.x = child.x - bounds.x
        clone.y = child.y - bounds.y
      }
    }

    const instance = component.createInstance()
    instance.x = bounds.x
    instance.y = bounds.y

    figma.currentPage.appendChild(component)
    figma.currentPage.appendChild(instance)

    frame.remove()

    figma.currentPage.selection = [instance]
    figma.viewport.scrollAndZoomIntoView([instance])

    return { component, instance }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'コンポーネントの作成に失敗しました。'
    emit(EVENT_ERROR, { message: `⚠️ ${message}` })
    return null
  }
}

function generateComponentName(nodes: readonly SceneNode[]): string {
  if (nodes.length === 1) {
    return `Component_${nodes[0].name}`
  }

  const types = new Set(nodes.map(node => node.type))
  if (types.size === 1) {
    const type = Array.from(types)[0]
    return `Component_${type}_Group`
  }

  return `Component_Mixed_${nodes.length}items`
}

function createInstanceFromComponent(component: ComponentNode): InstanceNode | null {
  try {
    const instance = component.createInstance()
    
    const lastInstance = figma.currentPage.findOne(
      node => node.type === 'INSTANCE' && (node as InstanceNode).mainComponent === component
    ) as InstanceNode | null

    if (lastInstance) {
      instance.x = lastInstance.x + lastInstance.width + 20
      instance.y = lastInstance.y
    } else {
      instance.x = component.x + component.width + 20
      instance.y = component.y
    }

    figma.currentPage.appendChild(instance)
    figma.currentPage.selection = [instance]
    figma.viewport.scrollAndZoomIntoView([instance])

    return instance
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'インスタンスの作成に失敗しました。'
    emit(EVENT_ERROR, { message: `⚠️ ${message}` })
    return null
  }
}

function findComponentByName(name: string): ComponentNode | null {
  const components = figma.currentPage.findAll(node => node.type === 'COMPONENT') as ComponentNode[]
  return components.find(comp => comp.name === name) || null
}

function parseCodexResponse(content: string): { shouldCreateComponent: boolean } {
  const lowerContent = content.toLowerCase()
  const componentKeywords = [
    'コンポーネント',
    'component',
    'コンポーネント化',
    '使い回',
    '再利用'
  ]

  const shouldCreateComponent = componentKeywords.some(keyword => 
    lowerContent.includes(keyword.toLowerCase())
  )

  return { shouldCreateComponent }
}
