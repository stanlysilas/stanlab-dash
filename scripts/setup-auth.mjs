import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const envPath = path.resolve('config/stanlab.env');
const currentEnv = await readFile(envPath, 'utf8').catch(() => readFile(path.resolve('config/stanlab.env.example'), 'utf8'));
const existingUsername = currentEnv.match(/^\s*DASH_USERNAME\s*=\s*(.*?)\s*$/m)?.[1] ?? '';
const defaultUsername = existingUsername && existingUsername !== 'stanly' ? existingUsername : process.env.USER ?? 'stanly';
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
const updatedEnv = setEnvValue(setEnvValue(currentEnv, 'DASH_USERNAME', username), 'DASH_PASSWORD_HASH', passwordHash);
const tempPath = `${envPath}.${process.pid}.tmp`;
await writeFile(tempPath, updatedEnv.endsWith('\n') ? updatedEnv : `${updatedEnv}\n`, { mode: 0o600, flag: 'wx' });
await chmod(tempPath, 0o600);
await rename(tempPath, envPath);
console.log('Credentials saved to config/stanlab.env with owner-only permissions. The password was not echoed or stored in plaintext.');

function setEnvValue(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

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
