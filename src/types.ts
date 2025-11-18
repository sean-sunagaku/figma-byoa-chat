export type SDK = 'codex' | 'claude'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: MessageRole
  content: string
}

export interface SubmitQueryPayload {
  text: string
  history: Array<ChatMessage>
  sdk: SDK
}

export interface SdkChangedPayload {
  sdk: SDK
}

export interface CodexResponsePayload {
  text: string
}

export interface PluginErrorPayload {
  message: string
}

export interface PluginUIProps {
  initialSdk: SDK
}

export interface ComponentCreatedPayload {
  componentName: string
  instanceCount: number
}

export interface ComponentActionPayload {
  action: 'create_component' | 'create_instance'
  componentName?: string
}
