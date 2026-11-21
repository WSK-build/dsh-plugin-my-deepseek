/**
 * Generates HarmonyOS app icons (light-blue rounded square + white whale) and
 * syncs the mobile web build into entry/src/main/resources/rawfile/www.
 *
 * Usage: node make-harmony-assets.mjs
 */
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const harmonyRoot = path.resolve(process.argv[2] ?? '.')
const repoRoot = path.resolve(harmonyRoot, '..')
const svg = await readFile(path.join(repoRoot, 'icon.svg'), 'utf8')

const LIGHT_BLUE = '#60A5FA'

const recolored = (color) => {
  let out = svg
  out = out.replace(/fill="(?!none)[^"]*"/g, `fill="${color}"`)
  out = out.replace(/stroke="(?!none)[^"]*"/g, `stroke="${color}"`)
  out = out.replace(/<path(?![^>]*fill=)/g, `<path fill="${color}"`)
  return out
}

const rasterize = async (svgText, width, height) =>
  sharp(Buffer.from(svgText), { density: 300 }).resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

const media = path.join(harmonyRoot, 'entry', 'src', 'main', 'resources', 'base', 'media')
await mkdir(media, { recursive: true })

const whaleWhite = recolored('#FFFFFF')
for (const size of [16, 32, 48, 64, 96, 128, 192, 256]) {
  const whale = await rasterize(whaleWhite, Math.round(size * 0.7), Math.round(size * 0.7))
  const icon = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await sharp(Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size / 5)}" fill="${LIGHT_BLUE}"/></svg>`)).png().toBuffer(), top: 0, left: 0 },
      { input: whale, top: Math.round(size * 0.15), left: Math.round(size * 0.15) },
    ])
    .png()
    .toBuffer()
  if (size <= 64 || size === 192) {
    await writeFile(path.join(media, `app_icon${size === 192 ? '_192' : ''}.png`), icon)
  }
}
await writeFile(path.join(media, 'app_icon.png'), await (async () => {
  const size = 216
  const whale = await rasterize(whaleWhite, Math.round(size * 0.7), Math.round(size * 0.7))
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await sharp(Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size / 5)}" fill="${LIGHT_BLUE}"/></svg>`)).png().toBuffer(), top: 0, left: 0 },
      { input: whale, top: Math.round(size * 0.15), left: Math.round(size * 0.15) },
    ])
    .png()
    .toBuffer()
})())

// Sync the mobile web build into rawfile/www.
const www = path.join(harmonyRoot, 'entry', 'src', 'main', 'resources', 'rawfile', 'www')
await mkdir(www, { recursive: true })
await cp(path.join(repoRoot, 'build', 'mobile', 'www'), www, { recursive: true })

console.log('harmony assets ready: media icons + rawfile/www')
