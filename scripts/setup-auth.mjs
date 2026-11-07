import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const dataDirectory = process.env.STANLAB_DATA_DIR
  ?? path.resolve(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'stanlab-dash');
const credentialsPath = path.join(dataDirectory, 'credentials.json');
const currentCredentials = await readFile(credentialsPath, 'utf8').then((value) => JSON.parse(value)).catch(() => ({}));
const existingUsername = typeof currentCredentials.username === 'string' ? currentCredentials.username : '';
const defaultUsername = existingUsername || process.env.STANLAB_DEFAULT_USERNAME || 'admin';
let username = defaultUsername;
const lineReader = createInterface({ input: process.stdin, output: process.stdout });

try {
  const enteredUsername = (await lineReader.question(`Dashboard username [${defaultUsername}]: `)).trim();
  username = enteredUsername || defaultUsername;
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error('Use 1–64 letters, numbers, dots, underscores, or hyphens for the username.');
} finally {
  lineReader.close();
}

const password = await promptHidden('Dashboard password (minimum 12 characters): ');
const confirmation = await promptHidden('Confirm password: ');
if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
if (password !== confirmation) throw new Error('The passwords did not match. No credentials were written.');

const salt = randomBytes(16).toString('hex');
const derivedKey = await scrypt(password, salt, 64);
const passwordHash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
await chmod(dataDirectory, 0o700);
const tempPath = `${credentialsPath}.${process.pid}.tmp`;
await writeFile(tempPath, `${JSON.stringify({ username, passwordHash }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
await chmod(tempPath, 0o600);
await rename(tempPath, credentialsPath);
console.log('Credentials saved to the persistent data volume with owner-only permissions. The password was not echoed or stored in plaintext.');

function promptHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new Error('Run this command directly in a terminal so the password can stay hidden.'));
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Credential setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (character >= ' ' && character !== '\u007f') value += character;
      }
    };
    input.on('data', onData);
  });
}
