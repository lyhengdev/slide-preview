import sharp from "sharp";

const mk = sharp({
  create: {
    width: 1600,
    height: 900,
    channels: 3,
    background: { r: 30, g: 80, b: 160 },
  },
});

const src = await mk
  .composite([{ input: { text: { text: "SLIDE SANITY", fontsize: 120 } }, gravity: "center" }])
  .png()
  .toBuffer();

const renderTier = (targetWidth: number, quality: number) =>
  sharp(src)
    .resize({ width: targetWidth, withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toBuffer();

const [preview, standard, full] = await Promise.all([
  renderTier(384, 55),
  renderTier(1280, 72),
  renderTier(1920, 80),
]);

const info = async (b: Buffer, name: string) => {
  const m = await sharp(b).metadata();
  console.log(`${name}: ${b.length} bytes, ${m.width}x${m.height}`);
  return {
    name,
    bytes: b.length,
    width: m.width ?? 0,
    ...(await (async (x) => ({ height: x }))(m.height ?? 0)),
  };
};

const previewI = await info(preview, "preview");
const standardI = await info(standard, "standard");
const fullI = await info(full, "full");

const ok =
  previewI.bytes < standardI.bytes &&
  standardI.bytes < fullI.bytes &&
  previewI.width < standardI.width &&
  standardI.width < fullI.width &&
  previewI.height < standardI.height &&
  standardI.height < fullI.height;

console.log(ok ? "PASS: tiers ordered preview < standard < full" : "FAIL: tier ordering");
process.exit(ok ? 0 : 1);