import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveGitExecPath = () => {
  if (process.platform !== 'win32' || process.env.GIT_EXEC_PATH) {
    return process.env.GIT_EXEC_PATH
  }
  const probe = spawnSync('git', ['--exec-path'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (probe.status !== 0) return undefined
  const current = probe.stdout.trim()
  if (existsSync(resolve(current, 'git-remote-https.exe'))) return current
  const bundledBin = resolve(current, '..', '..', 'bin')
  return existsSync(resolve(bundledBin, 'git-remote-https.exe')) ? bundledBin : undefined
}

const gitExecPath = resolveGitExecPath()

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command === 'npm',
    env: command === 'git' && gitExecPath
      ? { ...process.env, GIT_EXEC_PATH: gitExecPath }
      : process.env
  })

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || '')
    }
    throw new Error(`${command} ${args.join(' ')} failed`)
  }

  return options.capture ? result.stdout.trim() : ''
}

const git = (...args) => run('git', args, { capture: true })
const fail = (message) => {
  throw new Error(message)
}

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const version = pkg.version
  const tag = `v${version}`

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`package.json version is not a release version: ${version}`)
  }
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    fail('package.json and package-lock.json versions do not match')
  }
  if (git('branch', '--show-current') !== 'main') {
    fail('release must run from the main branch')
  }
  if (git('status', '--porcelain')) {
    fail('commit or discard all local changes before releasing')
  }

  const head = git('rev-parse', 'HEAD')
  const remoteMain = git('ls-remote', '--heads', 'origin', 'refs/heads/main').split(/\s+/)[0]
  if (!remoteMain) {
    fail('could not read origin/main')
  }

  const remoteTagLines = git(
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`
  ).split(/\r?\n/)
  const remoteTagLine =
    remoteTagLines.find((line) => line.endsWith('^{}')) || remoteTagLines.find(Boolean) || ''
  const remoteTag = remoteTagLine.split(/\s+/)[0]
  if (remoteTag && remoteTag !== head) {
    fail(`${tag} already exists on another commit`)
  }

  console.log(`\nReleasing Stream Panel ${version}\n`)
  run('npm', ['run', 'lint'])
  run('npm', ['run', 'typecheck'])
  run('npm', ['test'])

  if (remoteMain !== head) {
    run('git', ['push', 'origin', 'HEAD:main'])
  }

  if (!remoteTag) {
    const localTag = git('tag', '--list', tag)
    if (!localTag) {
      run('git', ['tag', '-a', tag, '-m', `Stream Panel ${version}`])
    } else if (git('rev-list', '-n', '1', tag) !== head) {
      fail(`local ${tag} points to another commit`)
    }
    run('git', ['push', 'origin', `refs/tags/${tag}`])
  }

  console.log(`\nRelease build started: https://github.com/deepsky616/stream-panel/actions/workflows/release.yml`)
} catch (error) {
  console.error(`\nRelease stopped: ${error.message}`)
  console.error('If Git authentication is unavailable, push main through GitHub and run the Release workflow manually.')
  process.exit(1)
}
