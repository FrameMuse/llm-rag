import { readFile } from "fs/promises"
import { createHash } from "crypto"
import sharp from "sharp"

const VISION_SYSTEM_PROMPT = "Describe this image in detail suitable for searching. Include: visible objects, colors, text, layout, and distinguishing features. Be specific but concise."

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]

export function isImage(filePath: string): boolean {
  return IMAGE_EXTS.some((ext) => filePath.toLowerCase().endsWith(ext))
}

async function imageToDataUri(filePath: string): Promise<string> {
  let buffer: Buffer
  if (filePath.toLowerCase().endsWith(".svg")) {
    buffer = await sharp(filePath).png().toBuffer()
  } else {
    buffer = await readFile(filePath)
  }
  const ext = filePath.toLowerCase().replace(/.*\./, "").replace("jpg", "jpeg")
  return `data:image/${ext};base64,${buffer.toString("base64")}`
}

export async function describeImage(
  filePath: string,
  visionModel: string,
  projectDir: string,
): Promise<string | null> {
  try {
    const dataUri = await imageToDataUri(filePath)
    const { chat } = await import("./embedder")
    return await chat(VISION_SYSTEM_PROMPT, dataUri, visionModel, 0.2)
  } catch (e) {
    console.error(`  Failed to caption ${filePath}: ${e}`)
    return null
  }
}
