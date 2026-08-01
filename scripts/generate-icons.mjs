import { copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pngToIco from 'png-to-ico';

const source = resolve('build/icon.png');
const appIcon = await pngToIco(source);
await Promise.all([
  writeFile(resolve('build/icon.ico'), appIcon),
  writeFile(resolve('resources/tray.ico'), appIcon),
  copyFile(source, resolve('resources/tray.png')),
]);
