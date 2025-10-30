export class UnsupportedToolError extends Error {
  constructor(tool: string) {
    super(`Unsupported tool: ${tool}`);
    this.name = 'UnsupportedToolError';
  }
}
