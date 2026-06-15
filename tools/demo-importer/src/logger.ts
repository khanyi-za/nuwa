/* Minimal leveled logger. The tool is a CLI — plain stdout/stderr is the UX. */

type Level = 'info' | 'warn' | 'error' | 'ok';

const PREFIX: Record<Level, string> = {
  info: '  ',
  ok: '✓ ',
  warn: '! ',
  error: '✗ ',
};

function emit(level: Level, msg: string): void {
  const line = `${PREFIX[level]}${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (m: string) => emit('info', m),
  ok: (m: string) => emit('ok', m),
  warn: (m: string) => emit('warn', m),
  error: (m: string) => emit('error', m),
  step: (m: string) => console.log(`\n▸ ${m}`),
};
