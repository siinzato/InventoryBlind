// Parser de user-agent pequeno e dependency-free (CLAUDE.md: "não instale
// dependências novas"). Cobre os navegadores/sistemas/dispositivos comuns o
// suficiente para o painel de sessões — não tenta ser um substituto completo
// de uma lib como ua-parser-js.

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface ParsedUserAgent {
  browser: string;
  os: string;
  deviceType: DeviceType;
  raw: string;
}

const UNKNOWN_LABEL = 'Desconhecido';

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const raw = (ua ?? '').trim();
  if (!raw) {
    return { browser: UNKNOWN_LABEL, os: UNKNOWN_LABEL, deviceType: 'unknown', raw: '' };
  }
  return {
    browser: detectBrowser(raw),
    os: detectOs(raw),
    deviceType: detectDeviceType(raw),
    raw,
  };
}

// Ordem importa: Edge e Opera incluem "Chrome/" na própria UA string, e o
// Chrome inclui "Safari/" — cada checagem mais específica precisa vir antes
// da mais genérica que ela também bateria.
function detectBrowser(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Microsoft Edge';
  if (/OPR\//.test(ua) || /Opera\//.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/FBAN|FBAV/.test(ua)) return 'Facebook (in-app)';
  if (/Instagram/.test(ua)) return 'Instagram (in-app)';
  if (/CriOS\//.test(ua)) return 'Chrome (iOS)';
  if (/FxiOS\//.test(ua)) return 'Firefox (iOS)';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chromium\//.test(ua)) return 'Chromium';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return 'Safari';
  if (/MSIE |Trident\//.test(ua)) return 'Internet Explorer';
  return UNKNOWN_LABEL;
}

function detectOs(ua: string): string {
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
  if (/Windows NT 6\.2/.test(ua)) return 'Windows 8';
  if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
  if (/Windows/.test(ua)) return 'Windows';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return UNKNOWN_LABEL;
}

function detectDeviceType(ua: string): DeviceType {
  if (/iPad/.test(ua)) return 'tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'mobile';
  if (/Windows|Macintosh|Mac OS X|X11|Linux|CrOS/.test(ua)) return 'desktop';
  return 'unknown';
}
