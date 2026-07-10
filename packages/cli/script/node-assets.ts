import { createHash } from "node:crypto"
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  attentionSoundAssets,
  type NodeTarget,
  opentuiParserAssets,
  opentuiParserWorkerAsset,
  photonWasmAsset,
  webTreeSitterWasmAsset,
} from "../src/node/target"

const dir = path.resolve(import.meta.dirname, "..")

// Bun's compiler discovers file imports and embeds them in its virtual filesystem. Vite only bundles the JavaScript
// portion of the Node executable, while SEA embeds only the assets explicitly listed in its build configuration.
// Collect and stage those files under stable keys so the SEA prelude can extract them to real paths at startup;
// native addons, helper executables, and other path-based consumers cannot use assets directly from SEA memory.
export type NodeAsset = {
  readonly key: string
  readonly source: string
}

async function files(root: string, current = root): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(current, { withFileTypes: true })).map((entry) => {
        const target = path.join(current, entry.name)
        return entry.isDirectory() ? files(root, target) : [path.relative(root, target)]
      }),
    )
  ).flat()
}

export async function collectNodeAssets(target: NodeTarget) {
  const opentuiRoot = path.dirname(fileURLToPath(import.meta.resolve("@opentui/core")))
  const webTreeSitterRoot = path.resolve(opentuiRoot, "..", "..", "web-tree-sitter")
  const opentuiNativeRoot = path.dirname(fileURLToPath(import.meta.resolve(target.opentuiNativePackage)))
  const ptyEntry = fileURLToPath(import.meta.resolve(target.nodePtyPackage))
  const ptyRoot = path.resolve(path.dirname(ptyEntry), "..")
  const assets: NodeAsset[] = [
    {
      key: target.opentuiNativeAsset,
      source: path.join(opentuiNativeRoot, path.basename(target.opentuiNativeAsset)),
    },
    ...opentuiParserAssets.map((key) => ({ key, source: path.join(opentuiRoot, key.replace("@opentui/core/", "")) })),
    { key: opentuiParserWorkerAsset, source: path.join(opentuiRoot, "parser.worker.js") },
    { key: webTreeSitterWasmAsset, source: path.join(webTreeSitterRoot, "tree-sitter.wasm") },
    { key: target.parcelWatcherAsset, source: fileURLToPath(import.meta.resolve(target.parcelWatcherPackage)) },
    {
      key: photonWasmAsset,
      source: path.resolve(dir, "../core/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"),
    },
    ...attentionSoundAssets.map((key) => ({
      key,
      source: path.resolve(dir, "../ui/src/assets/audio", path.basename(key)),
    })),
    ...(await files(ptyRoot))
      .filter((relative) => !relative.endsWith(".map") && !relative.endsWith(".pdb"))
      .map((relative) => ({
        key: `${target.nodePtyPackage}/${relative}`,
        source: path.join(ptyRoot, relative),
      })),
  ]
  await Promise.all(assets.map((asset) => stat(asset.source)))
  return assets
}

export async function hashNodeAssets(assets: readonly NodeAsset[]) {
  const hash = createHash("sha256")
  for (const asset of assets.toSorted((left, right) => left.key.localeCompare(right.key))) {
    hash.update(asset.key)
    hash.update(await readFile(asset.source))
  }
  return hash.digest("hex").slice(0, 16)
}

export async function copyNodeAssets(assets: readonly NodeAsset[]) {
  const root = path.join(dir, "dist-node", "assets")
  await Promise.all(
    assets
      .filter((asset) => asset.key !== opentuiParserWorkerAsset)
      .map(async (asset) => {
        const target = path.join(root, asset.key)
        await mkdir(path.dirname(target), { recursive: true })
        await copyFile(asset.source, target)
      }),
  )
  const worker = path.join(root, opentuiParserWorkerAsset)
  await mkdir(path.dirname(worker), { recursive: true })
  await copyFile(path.join(dir, "dist-node", "parser.worker.mjs"), worker)
}

export async function seaAssetMap() {
  const root = path.join(dir, "dist-node", "assets")
  return Object.fromEntries((await files(root)).map((key) => [key.replaceAll(path.sep, "/"), path.join(root, key)]))
}
