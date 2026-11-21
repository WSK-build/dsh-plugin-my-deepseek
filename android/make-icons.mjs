/**
 * Generates the Android launcher icons: the official whale glyph in light blue
 * on a white rounded square (legacy) plus adaptive icon layers (white
 * background layer, light-blue whale foreground).
 *
 * Usage: node make-icons.mjs [android-root]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const androidRoot = path.resolve(process.argv[2] ?? '.')
const repoRoot = path.resolve(androidRoot, '..')
const svg = await readFile(path.join(repoRoot, 'icon.svg'), 'utf8')

// The whale glyph itself is light blue; everything behind it is white.
const WHALE_BLUE = '#5EAAE7'
const WHITE = '#FFFFFF'

const resRoot = path.join(androidRoot, 'app', 'src', 'main', 'res')

const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const adaptiveGrid = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

/** Recolor every painted path in the SVG to one solid color. */
const recolored = (color) => {
  let out = svg
  out = out.replace(/fill="(?!none)[^"]*"/g, `fill="${color}"`)
  out = out.replace(/stroke="(?!none)[^"]*"/g, `stroke="${color}"`)
  out = out.replace(/<path(?![^>]*fill=)/g, `<path fill="${color}"`)
  return out
}

const rasterize = async (svgText, width, height) =>
  sharp(Buffer.from(svgText), { density: 300 }).resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

const whaleBlue = recolored(WHALE_BLUE)

for (const [density, size] of Object.entries(sizes)) {
  const mipmap = path.join(resRoot, `mipmap-${density}`)
  await mkdir(mipmap, { recursive: true })

  // Legacy: white rounded square, light-blue whale centered (70%).
  const whale = await rasterize(whaleBlue, Math.round(size * 0.7), Math.round(size * 0.7))
  const legacy = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: await roundedSquare(size, WHITE), top: 0, left: 0 },
      { input: whale, top: Math.round(size * 0.15), left: Math.round(size * 0.15) },
    ])
    .png()
    .toBuffer()
  await writeFile(path.join(mipmap, 'ic_launcher.png'), legacy)
  await writeFile(path.join(mipmap, 'ic_launcher_round.png'), legacy)

  // Adaptive foreground: light-blue whale in the inner 45% of the 108dp grid
  // (transparent margins; the background layer supplies the white).
  const grid = adaptiveGrid[density]
  const fgWhale = await rasterize(whaleBlue, Math.round(grid * 0.45), Math.round(grid * 0.45))
  const fg = await sharp({
    create: { width: grid, height: grid, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fgWhale, top: Math.round(grid * 0.275), left: Math.round(grid * 0.275) }])
    .png()
    .toBuffer()
  await writeFile(path.join(mipmap, 'ic_launcher_foreground.png'), fg)
}

/** Solid rounded square as PNG. */
async function roundedSquare(size, color) {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size / 5)}" fill="${color}"/></svg>`)
  return sharp(mask).png().toBuffer()
}

// Splash: full-bleed white with the light-blue whale centered (drawable).
const splashDir = path.join(resRoot, 'drawable')
await mkdir(splashDir, { recursive: true })
{
  // Vector drawable referencing a PNG keeps quality; simplest robust form is a
  // layer-list with the centered whale bitmap over a white background.
  const densityPx = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
  for (const [density, px] of Object.entries(densityPx)) {
    const dir = path.join(resRoot, `drawable-${density}`)
    await mkdir(dir, { recursive: true })
    const whale = await rasterize(whaleBlue, Math.round(px * 0.28), Math.round(px * 0.28))
    await writeFile(path.join(dir, 'splash_whale.png'), whale)
  }
}

console.log('icons + splash whale generated under', resRoot)
