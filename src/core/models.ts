export const EMBED_LEVELS = [
  "all-minilm:33m",
  "nomic-embed-text",
  "mxbai-embed-large",
  "snowflake-arctic-embed2",
]

export const RAG_LEVELS = [
  "llama3.2:3b",
  "qwen2.5:7b",
  "llama3.1:8b",
  "qwen2.5:14b",
]

export function resolveLevel(level: number): { embedModel: string; ragModel: string } {
  const idx = Math.max(0, Math.min(level, 3))
  return { embedModel: EMBED_LEVELS[idx], ragModel: RAG_LEVELS[idx] }
}
