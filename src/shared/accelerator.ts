import type { AppConfig } from './types';

const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  control: 'CommandOrControl',
  ctrl: 'CommandOrControl',
  command: 'CommandOrControl',
  cmd: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
};

export function normalizeAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token.toLowerCase()] ?? token)
    .join('+');
}

export function buildNumberAccelerators(modifier: string): string[] {
  const normalizedModifier = modifier
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
    .join('+');
  return Array.from(
    { length: 10 },
    (_, index) => `${normalizedModifier}+${index === 9 ? 0 : index + 1}`,
  );
}

export function formatNumberModifier(
  modifier: string,
  platform: AppConfig['platform'],
): string {
  const tokens = modifier.split('+').map((token) => token.trim()).filter(Boolean);
  return tokens
    .map((token) => {
      if (token === 'Control') return 'Ctrl';
      if (token === 'CommandOrControl') return platform === 'darwin' ? '⌘' : 'Ctrl';
      if (token === 'Super') return platform === 'darwin' ? '⌘' : 'Win';
      if (token === 'Alt') return platform === 'darwin' ? '⌥' : 'Alt';
      if (token === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift';
      return token;
    })
    .join('+');
}

export function formatAccelerator(
  accelerator: string,
  platform: AppConfig['platform'],
): string {
  const tokens = normalizeAccelerator(accelerator).split('+').filter(Boolean);
  if (platform === 'win32') {
    return tokens
      .map((token) => {
        if (token === 'CommandOrControl') return 'Ctrl';
        if (token === 'Super') return 'Win';
        return token;
      })
      .join('+');
  }

  return tokens
    .map((token) => {
      if (token === 'CommandOrControl' || token === 'Super') return '⌘';
      if (token === 'Alt') return '⌥';
      if (token === 'Shift') return '⇧';
      return token;
    })
    .join('');
}
