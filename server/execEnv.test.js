// server/execEnv.test.js
import {describe, it, expect} from 'vitest';
import {buildExecEnv, SECRET_KEY_PATTERN} from './execEnv.js';

// Representative slice of the server's real process.env: Windows system vars
// the child needs, npm config noise, and the keyring loaded from .env.
const PROC = {
  PATH: 'C:\\Windows\\system32;C:\\Program Files\\nodejs',
  SystemRoot: 'C:\\Windows',
  APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
  TEMP: 'C:\\Users\\user\\AppData\\Local\\Temp',
  USERPROFILE: 'C:\\Users\\user',
  npm_config_cache: 'C:\\Users\\user\\AppData\\Local\\npm-cache',
  ANTHROPIC_API_KEY: 'sk-ant-aaa111',
  KIE_API_KEY: 'kie-bbb222',
  WHATSAPP_ACCESS_TOKEN: 'wa-ccc333',
  GOOGLE_DRIVE_SA_KEY: '.secrets/sa.json',
  SLACK_SIGNING_SECRET: 'slack-ddd444',
  DB_PASSWORD: 'hunter2',
  legacy_passwd: 'oldpass',
  AWS_CREDENTIAL_FILE: 'C:\\creds',
  MY_PRIVATE_SALT: 'pepper',
};
const SECRET_NAMES = Object.keys(PROC).filter((k) => SECRET_KEY_PATTERN.test(k));
const SECRET_VALUES = SECRET_NAMES.map((k) => PROC[k]);

describe('buildExecEnv', () => {
  it('strips secret-looking keys by default', () => {
    const {env} = buildExecEnv(PROC);
    for (const name of SECRET_NAMES) expect(env).not.toHaveProperty(name);
  });

  it('passes PATH, SystemRoot, and other system vars through untouched', () => {
    const {env} = buildExecEnv(PROC);
    expect(env.PATH).toBe(PROC.PATH);
    expect(env.SystemRoot).toBe(PROC.SystemRoot);
    expect(env.APPDATA).toBe(PROC.APPDATA);
    expect(env.TEMP).toBe(PROC.TEMP);
    expect(env.USERPROFILE).toBe(PROC.USERPROFILE);
    expect(env.npm_config_cache).toBe(PROC.npm_config_cache);
  });

  it('applies requestEnv last — overrides win and can reintroduce a stripped key', () => {
    const {env, strippedKeys} = buildExecEnv(PROC, {
      PATH: 'D:\\custom\\bin',
      ANTHROPIC_API_KEY: 'sk-ant-explicit',
      NEW_FLAG: '1',
    });
    expect(env.PATH).toBe('D:\\custom\\bin');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-explicit');
    expect(env.NEW_FLAG).toBe('1');
    // An explicitly supplied key is present in the final env, so it is not
    // reported as withheld; the rest of the keyring still is.
    expect(strippedKeys).not.toContain('ANTHROPIC_API_KEY');
    expect(strippedKeys).toContain('KIE_API_KEY');
    // requestEnv entries are never stripped, even secret-shaped ones.
    const {env: env2} = buildExecEnv(PROC, {EXTRA_TOKEN: 'tok-explicit'});
    expect(env2.EXTRA_TOKEN).toBe('tok-explicit');
  });

  it('inheritSecrets: true passes the full processEnv through', () => {
    const {env, strippedKeys} = buildExecEnv(PROC, {}, {inheritSecrets: true});
    expect(env).toEqual(PROC);
    expect(strippedKeys).toEqual([]);
  });

  it('reports strippedKeys as sorted names only — never values', () => {
    const {strippedKeys} = buildExecEnv(PROC);
    expect(strippedKeys).toEqual([...SECRET_NAMES].sort());
    expect(strippedKeys).toEqual([...strippedKeys].sort());
    const serialized = JSON.stringify(strippedKeys);
    for (const value of SECRET_VALUES) expect(serialized).not.toContain(value);
  });

  it('matches secret patterns case-insensitively (legacy_passwd, lowercase tokens)', () => {
    const {env, strippedKeys} = buildExecEnv({PATH: 'x', legacy_passwd: 'p', api_token: 't'});
    expect(env).toEqual({PATH: 'x'});
    expect(strippedKeys).toEqual(['api_token', 'legacy_passwd']);
  });

  it('tolerates missing/null requestEnv and processEnv', () => {
    expect(buildExecEnv(PROC, null)).toEqual(buildExecEnv(PROC));
    expect(buildExecEnv(null, {A: '1'}).env).toEqual({A: '1'});
  });
});
