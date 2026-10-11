import sharp from 'sharp';
for (const size of [192, 512]) {
  await sharp('src/web/public/icon.svg').resize(size, size).png().toFile(`src/web/public/icon-${size}.png`);
}
console.log('icons written');
