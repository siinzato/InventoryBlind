import { describe, expect, it } from 'vitest';
import { parseUserAgent } from '../userAgentParser';

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_CHROME =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const WINDOWS_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

describe('parseUserAgent', () => {
  it('identifica Chrome no Windows como desktop', () => {
    const r = parseUserAgent(WINDOWS_CHROME);
    expect(r.browser).toBe('Chrome');
    expect(r.os).toBe('Windows 10/11');
    expect(r.deviceType).toBe('desktop');
  });

  it('identifica Safari no macOS como desktop', () => {
    const r = parseUserAgent(MAC_SAFARI);
    expect(r.browser).toBe('Safari');
    expect(r.os).toBe('macOS');
    expect(r.deviceType).toBe('desktop');
  });

  it('identifica Safari no iPhone como mobile', () => {
    const r = parseUserAgent(IPHONE_SAFARI);
    expect(r.browser).toBe('Safari');
    expect(r.os).toBe('iOS');
    expect(r.deviceType).toBe('mobile');
  });

  it('identifica Safari no iPad como tablet (iPadOS, não iOS)', () => {
    const r = parseUserAgent(IPAD_SAFARI);
    expect(r.os).toBe('iPadOS');
    expect(r.deviceType).toBe('tablet');
  });

  it('identifica Chrome no Android (telefone) como mobile', () => {
    const r = parseUserAgent(ANDROID_CHROME);
    expect(r.browser).toBe('Chrome');
    expect(r.os).toBe('Android');
    expect(r.deviceType).toBe('mobile');
  });

  it('identifica Chrome no Android (tablet, sem token Mobile) como tablet', () => {
    const r = parseUserAgent(ANDROID_TABLET_CHROME);
    expect(r.deviceType).toBe('tablet');
  });

  it('identifica Edge (Chromium) e não confunde com Chrome, mesmo com "Chrome/" na string', () => {
    const r = parseUserAgent(WINDOWS_EDGE);
    expect(r.browser).toBe('Microsoft Edge');
  });

  it('identifica Firefox no Windows', () => {
    const r = parseUserAgent(WINDOWS_FIREFOX);
    expect(r.browser).toBe('Firefox');
    expect(r.deviceType).toBe('desktop');
  });

  it('identifica Linux desktop', () => {
    const r = parseUserAgent(LINUX_CHROME);
    expect(r.os).toBe('Linux');
    expect(r.deviceType).toBe('desktop');
  });

  it('retorna "Desconhecido" e deviceType "unknown" para string vazia/nula, nunca lança', () => {
    expect(parseUserAgent(null)).toEqual({ browser: 'Desconhecido', os: 'Desconhecido', deviceType: 'unknown', raw: '' });
    expect(parseUserAgent(undefined)).toEqual({ browser: 'Desconhecido', os: 'Desconhecido', deviceType: 'unknown', raw: '' });
    expect(parseUserAgent('   ')).toEqual({ browser: 'Desconhecido', os: 'Desconhecido', deviceType: 'unknown', raw: '' });
  });

  it('não lança para uma string arbitrária não reconhecida', () => {
    const r = parseUserAgent('curl/8.0.1');
    expect(r.browser).toBe('Desconhecido');
    expect(r.raw).toBe('curl/8.0.1');
  });
});
