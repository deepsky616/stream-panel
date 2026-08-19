import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveGitRuntime = () => {
  if (process.platform !== 'win32') {
    return { command: 'git', execPath: process.env.GIT_EXEC_PATH, useOpenSsl: false }
  }

  // Prefer the verified full MinGit beside this checkout. Codex's lightweight
  // Git can contain an HTTPS helper but still fail to acquire Windows
  // credentials through Schannel, which makes releases fail before push.
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

  return { command: 'git', execPath: process.env.GIT_EXEC_PATH, useOpenSsl: false }
}

const gitRuntime = resolveGitRuntime()

const resolveGhCredentialHelper = () => {
  if (process.platform !== 'win32') return null
  const toolsDirectory = resolve(process.cwd(), '..', '.tools')
  if (!existsSync(toolsDirectory)) return null
  const candidates = readdirSync(toolsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('gh-'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const candidate of candidates) {
    const command = resolve(toolsDirectory, candidate, 'bin', 'gh.exe')
    if (!existsSync(command)) continue
    const status = spawnSync(command, ['auth', 'status', '--hostname', 'github.com'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe'
    })
    if (status.status === 0) return command.replaceAll('\\', '/')
  }
  return null
}

const ghCredentialHelper = resolveGhCredentialHelper()

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    input: options.input,
    shell: process.platform === 'win32' && command === 'npm',
    env: options.env ?? process.env
  })

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || '')
    }
    throw new Error(`${command} ${args.join(' ')} failed`)
  }

  return options.capture
    ? options.raw
      ? result.stdout
      : result.stdout.trim()
    : ''
}

const runGit = (args, options = {}) => run(
  gitRuntime.command,
  [
    ...(gitRuntime.useOpenSsl ? ['-c', 'http.sslBackend=openssl'] : []),
    ...(ghCredentialHelper ? [
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=!${ghCredentialHelper} auth git-credential`
    ] : []),
    ...args
  ],
  {
    ...options,
    env: gitRuntime.execPath
      ? { ...process.env, GIT_EXEC_PATH: gitRuntime.execPath }
      : process.env
  }
)
const git = (...args) => runGit(args, { capture: true })
const gitRaw = (...args) => runGit(args, { capture: true, raw: true })
const repository = 'deepsky616/stream-panel'

const ghApi = (endpoint, method = 'GET', body) => {
  if (!ghCredentialHelper) throw new Error('authenticated GitHub CLI is required')
  const args = ['api', endpoint]
  if (method !== 'GET') args.push('--method', method)
  if (body !== undefined) args.push('--input', '-')
  return JSON.parse(run(ghCredentialHelper, args, {
    capture: true,
    input: body === undefined ? undefined : JSON.stringify(body)
  }))
}

const readGhRef = (ref) => {
  if (!ghCredentialHelper) return ''
  const result = spawnSync(
    ghCredentialHelper,
    ['api', `repos/${repository}/git/ref/${ref}`, '--jq', '.object.sha'],
    { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' }
  )
  if (result.status === 0) return result.stdout.trim()
  if (/HTTP 404/.test(result.stderr || '')) return ''
  process.stderr.write(result.stderr || result.stdout || '')
  throw new Error(`could not read GitHub ref ${ref}`)
}

const identity = (head, prefix) => ({
  name: git('show', '-s', `--format=%${prefix}n`, head),
  email: git('show', '-s', `--format=%${prefix}e`, head),
  date: git('show', '-s', `--format=%${prefix}I`, head)
})

const createRemoteBlobEntry = (head, path) => {
  const treeLine = git('ls-tree', head, '--', path)
  const match = /^(\d+)\s+blob\s+([0-9a-f]{40})\t/.exec(treeLine)
  if (!match) throw new Error(`could not read committed file ${path}`)
  const [, mode, localSha] = match
  const content = gitRaw('show', `${head}:${path}`)
  const created = ghApi(`repos/${repository}/git/blobs`, 'POST', {
    content: Buffer.from(content, 'utf8').toString('base64'),
    encoding: 'base64'
  })
  if (created.sha !== localSha) {
    throw new Error(`GitHub blob verification failed for ${path}`)
  }
  return { path, mode, type: 'blob', sha: localSha }
}

const publishCommitViaGitHubApi = (head, expectedParent) => {
  const parent = git('rev-parse', `${head}^`)
  if (parent !== expectedParent) {
    throw new Error('origin/main changed; update the checkout before releasing')
  }
  const entries = []
  const changes = git(
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    '-M',
    parent,
    head
  ).split(/\r?\n/).filter(Boolean)
  for (const line of changes) {
    const [status, firstPath, secondPath] = line.split('\t')
    if (status === 'D') {
      entries.push({ path: firstPath, mode: '100644', type: 'blob', sha: null })
    } else if (status.startsWith('R')) {
      entries.push({ path: firstPath, mode: '100644', type: 'blob', sha: null })
      entries.push(createRemoteBlobEntry(head, secondPath))
    } else {
      entries.push(createRemoteBlobEntry(head, firstPath))
    }
  }
  const localTree = git('rev-parse', `${head}^{tree}`)
  const createdTree = ghApi(`repos/${repository}/git/trees`, 'POST', {
    base_tree: git('rev-parse', `${parent}^{tree}`),
    tree: entries
  })
  if (createdTree.sha !== localTree) {
    throw new Error('GitHub tree verification failed; main was not changed')
  }
  const message = gitRaw('show', '-s', '--format=%B', head).replace(/\r?\n$/, '')
  const createdCommit = ghApi(`repos/${repository}/git/commits`, 'POST', {
    message,
    tree: localTree,
    parents: [parent],
    author: identity(head, 'a'),
    committer: identity(head, 'c')
  })
  if (createdCommit.sha !== head) {
    throw new Error('GitHub commit verification failed; main was not changed')
  }
  ghApi(`repos/${repository}/git/refs/heads/main`, 'PATCH', { sha: head, force: false })
  runGit(['update-ref', 'refs/remotes/origin/main', head, expectedParent])
}

const fail = (message) => {
  throw new Error(message)
}

try {
  const pushOnly = process.argv.includes('--push-only')
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
  const remoteMain = ghCredentialHelper
    ? readGhRef('heads/main')
    : git('ls-remote', '--heads', 'origin', 'refs/heads/main').split(/\s+/)[0]
  if (!remoteMain) {
    fail('could not read origin/main')
  }

  const remoteTag = pushOnly
    ? ''
    : ghCredentialHelper
    ? readGhRef(`tags/${tag}`)
    : (() => {
        const lines = git(
          'ls-remote',
          '--tags',
          'origin',
          `refs/tags/${tag}`,
          `refs/tags/${tag}^{}`
        ).split(/\r?\n/)
        const line = lines.find((candidate) => candidate.endsWith('^{}')) ||
          lines.find(Boolean) ||
          ''
        return line.split(/\s+/)[0]
      })()
  if (!pushOnly && remoteTag && remoteTag !== head) {
    fail(`${tag} already exists on another commit`)
  }

  console.log(pushOnly
    ? '\nPublishing Stream Panel main\n'
    : `\nReleasing Stream Panel ${version}\n`)
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
    if (ghCredentialHelper) publishCommitViaGitHubApi(head, remoteMain)
    else runGit(['push', 'origin', 'HEAD:main'])
  }

  if (!pushOnly && !remoteTag) {
    if (ghCredentialHelper) {
      ghApi(`repos/${repository}/git/refs`, 'POST', { ref: `refs/tags/${tag}`, sha: head })
      if (!git('tag', '--list', tag)) runGit(['tag', tag, head])
    } else {
      const localTag = git('tag', '--list', tag)
      if (!localTag) {
        run('git', ['tag', '-a', tag, '-m', `Stream Panel ${version}`])
      } else if (git('rev-list', '-n', '1', tag) !== head) {
        fail(`local ${tag} points to another commit`)
      }
      runGit(['push', 'origin', `refs/tags/${tag}`])
    }
  }

  if (pushOnly) {
    console.log('\nStream Panel main published\n')
  } else {
    console.log(`\nRelease build started: https://github.com/deepsky616/stream-panel/actions/workflows/release.yml`)
  }
} catch (error) {
  console.error(`\nRelease stopped: ${error.message}`)
  console.error('If Git authentication is unavailable, push main through GitHub and run the Release workflow manually.')
  process.exit(1)
}
