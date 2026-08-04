import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = join(projectRoot, 'browser-extension');
const manifestPath = join(extensionDirectory, 'manifest.json');
const packageFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'setup.js',
  'workflow-engine.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons',
];

for (const relativePath of packageFiles) {
  const path = join(extensionDirectory, relativePath);
  if (!existsSync(path)) {
    throw new Error(`확장 기능 필수 파일을 찾을 수 없습니다. 저장소를 다시 받아 주세요: ${path}`);
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3 || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version ?? '')) {
  throw new Error('확장 기능 선언 파일의 형식이나 버전이 올바르지 않습니다. manifest.json을 확인해 주세요.');
}

const outputDirectory = join(projectRoot, 'dist');
const outputPath = join(
  outputDirectory,
  `StreamPanel-Web-Connector-${manifest.version}.zip`,
);
mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync('zip', ['-q', '-FS', '-r', outputPath, ...packageFiles], {
  cwd: extensionDirectory,
  stdio: 'inherit',
});
if (result.error) {
  throw new Error(`확장 기능 묶음을 만들지 못했습니다. zip 명령을 설치한 뒤 다시 시도해 주세요: ${result.error.message}`);
}
if (result.status !== 0) {
  throw new Error(`확장 기능 묶음을 만들지 못했습니다. zip 명령 종료 코드를 확인해 주세요: ${result.status}`);
}

console.log(outputPath);
