import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [, , installerArgument, outputArgument] = process.argv

if (!installerArgument || !outputArgument) {
  throw new Error('Usage: node scripts/generate-download-site.mjs <installer.exe> <output-dir>')
}

const installerPath = resolve(installerArgument)
const outputDir = resolve(outputArgument)
const installerName = basename(installerPath)
const match = /^StreamPanel-(\d+\.\d+\.\d+)-Setup\.exe$/.exec(installerName)

if (!match) {
  throw new Error(`Unexpected installer name: ${installerName}`)
}

const version = match[1]
const installerStat = await stat(installerPath)
if (!installerStat.isFile() || installerStat.size <= 0) {
  throw new Error(`Installer is empty or unavailable: ${installerPath}`)
}

const digest = createHash('sha256')
for await (const chunk of createReadStream(installerPath)) digest.update(chunk)
const sha256 = digest.digest('hex')
const releaseUrl = `https://github.com/deepsky616/stream-panel/releases/tag/v${version}`
const releaseDownloadUrl = `${releaseUrl.replace('/tag/', '/download/')}/${installerName}`

await mkdir(outputDir, { recursive: true })
await copyFile(installerPath, join(outputDir, installerName))
await writeFile(
  join(outputDir, 'checksums.txt'),
  `${sha256}  ${installerName}\n`,
  'utf8',
)
await writeFile(
  join(outputDir, 'version.json'),
  `${JSON.stringify({ version, installerName, size: installerStat.size, sha256 }, null, 2)}\n`,
  'utf8',
)

const megabytes = (installerStat.size / 1_000_000).toFixed(1)
const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Stream Panel ${version} 다운로드</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Pretendard", "Noto Sans KR", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #25385d, #0b1020 58%); color: #f7f9ff; }
    main { width: min(620px, 100%); padding: 34px; border: 1px solid #ffffff1f; border-radius: 24px; background: #111a2ee8; box-shadow: 0 24px 70px #0008; }
    .eyebrow { color: #8eb6ff; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-size: clamp(28px, 5vw, 42px); }
    .lead { margin: 0 0 24px; color: #c8d2e8; line-height: 1.65; }
    .actions { display: grid; gap: 12px; }
    a, button { min-height: 52px; border-radius: 14px; border: 0; display: flex; align-items: center; justify-content: center; padding: 0 18px; font: inherit; font-weight: 750; cursor: pointer; text-decoration: none; }
    .primary { background: #70a7ff; color: #081223; }
    .secondary { background: #1d2b48; color: #eef4ff; border: 1px solid #ffffff20; }
    .primary:hover, .secondary:hover { filter: brightness(1.08); }
    .meta { margin-top: 24px; padding: 16px; border-radius: 14px; background: #080d19a8; color: #aebbd2; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
    #status { min-height: 24px; margin: 16px 0 0; color: #9fc2ff; font-weight: 650; }
    .help { margin: 18px 0 0; color: #94a2bc; font-size: 14px; line-height: 1.55; }
    .help a { min-height: auto; padding: 0; display: inline; color: #9fc2ff; font-weight: 650; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Stream Panel</div>
    <h1>Windows 설치 파일</h1>
    <p class="lead">GitHub의 만료되는 임시 자산 주소를 거치지 않는 고정 다운로드 페이지입니다.</p>
    <div class="actions">
      <a id="standard-download" class="primary" href="./${installerName}" download="${installerName}">바로 다운로드</a>
      <button id="save-download" class="secondary" type="button">저장 위치를 선택하여 다운로드</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <div class="meta">
      버전 ${version} · ${megabytes} MB<br>
      SHA-256: ${sha256}
    </div>
    <p class="help">빈 탭이 열리거나 저장되지 않으면 두 번째 버튼을 사용하세요. <a href="${releaseUrl}">GitHub 릴리스 정보</a> · <a href="${releaseDownloadUrl}">GitHub 원본 파일</a></p>
  </main>
  <script>
    const fileName = ${JSON.stringify(installerName)};
    const fileUrl = './' + fileName;
    const expectedSize = ${installerStat.size};
    const status = document.getElementById('status');
    const saveButton = document.getElementById('save-download');

    saveButton.addEventListener('click', async () => {
      if (!window.showSaveFilePicker) {
        status.textContent = '이 브라우저에서는 저장 위치 선택을 지원하지 않아 기본 다운로드를 시작합니다.';
        document.getElementById('standard-download').click();
        return;
      }
      saveButton.disabled = true;
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Windows 설치 파일', accept: { 'application/octet-stream': ['.exe'] } }]
        });
        status.textContent = '설치 파일을 준비하는 중입니다…';
        const response = await fetch(fileUrl, { cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error('다운로드 응답을 받지 못했습니다.');
        const writable = await handle.createWritable();
        let received = 0;
        const progress = new TransformStream({
          transform(chunk, controller) {
            received += chunk.byteLength;
            status.textContent = '다운로드 중… ' + Math.min(100, Math.round(received / expectedSize * 100)) + '%';
            controller.enqueue(chunk);
          }
        });
        await response.body.pipeThrough(progress).pipeTo(writable);
        if (received !== expectedSize) throw new Error('파일 크기 검증에 실패했습니다.');
        status.textContent = '다운로드가 완료되었습니다.';
      } catch (error) {
        if (error && error.name === 'AbortError') status.textContent = '저장이 취소되었습니다.';
        else status.textContent = '저장하지 못했습니다. 일반 Edge 또는 Chrome에서 다시 시도해 주세요.';
      } finally {
        saveButton.disabled = false;
      }
    });
  </script>
</body>
</html>
`

await writeFile(join(outputDir, 'index.html'), html, 'utf8')
console.log(JSON.stringify({ version, installerName, size: installerStat.size, sha256 }))
