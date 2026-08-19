import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveGitRuntime = () => {
  if (process.platform !== 'win32') {
    return { command: 'git', execPath: process.env.GIT_EXEC_PATH, useOpenSsl: false }
  }
  const probe = spawnSync('git', ['--exec-path'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (probe.status === 0) {
    const current = probe.stdout.trim()
    if (existsSync(resolve(current, 'git-remote-https.exe'))) {
      return { command: 'git', execPath: current, useOpenSsl: false }
    }
    const bundledBin = resolve(current, '..', '..', 'bin')
    if (existsSync(resolve(bundledBin, 'git-remote-https.exe'))) {
      return { command: 'git', execPath: bundledBin, useOpenSsl: false }
    }
  }

  // Codex's lightweight Windows Git runtime can omit the HTTPS remote helper.
  // Prefer a verified MinGit unpacked beside this checkout so releases remain
  // reproducible without modifying the user's system Git installation.
  const toolsDirectory = resolve(process.cwd(), '..', '.tools')
  if (existsSync(toolsDirectory)) {
    const candidates = readdirSync(toolsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('mingit-'))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    for (const candidate of candidates) {
      const root = resolve(toolsDirectory, candidate)
      const command = resolve(root, 'cmd', 'git.exe')
      const execPath = resolve(root, 'mingw64', 'bin')
      if (existsSync(command) && existsSync(resolve(execPath, 'git-remote-https.exe'))) {
        return { command, execPath, useOpenSsl: true }
      }
    }
  }

  return { command: 'git', execPath: process.env.GIT_EXEC_PATH, useOpenSsl: false }
}

const gitRuntime = resolveGitRuntime()

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command === 'npm',
    env: options.env ?? process.env
  })

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || '')
    }
    throw new Error(`${command} ${args.join(' ')} failed`)
  }

  return options.capture ? result.stdout.trim() : ''
}

const runGit = (args, options = {}) => run(
  gitRuntime.command,
  gitRuntime.useOpenSsl ? ['-c', 'http.sslBackend=openssl', ...args] : args,
  {
    ...options,
    env: gitRuntime.execPath
      ? { ...process.env, GIT_EXEC_PATH: gitRuntime.execPath }
      : process.env
  }
)
const git = (...args) => runGit(args, { capture: true })
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
  run(process.execPath, ['node_modules/eslint/bin/eslint.js', '.', '--ext', '.ts,.tsx'])
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json'])
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.web.json'])
  run(process.execPath, [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--configLoader',
    'runner'
  ])

  if (remoteMain !== head) {
    runGit(['push', 'origin', 'HEAD:main'])
  }

  if (!remoteTag) {
    const localTag = git('tag', '--list', tag)
    if (!localTag) {
      run('git', ['tag', '-a', tag, '-m', `Stream Panel ${version}`])
    } else if (git('rev-list', '-n', '1', tag) !== head) {
      fail(`local ${tag} points to another commit`)
    }
    runGit(['push', 'origin', `refs/tags/${tag}`])
  }

  console.log(`\nRelease build started: https://github.com/deepsky616/stream-panel/actions/workflows/release.yml`)
} catch (error) {
  console.error(`\nRelease stopped: ${error.message}`)
  console.error('If Git authentication is unavailable, push main through GitHub and run the Release workflow manually.')
  process.exit(1)
}
