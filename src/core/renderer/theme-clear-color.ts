/**
 * Keeps the GL clear color and the uUiLightTheme uniform in sync with the
 * UI theme: reads the `--surface-canvas` CSS token, falls back to the
 * prefers-color-scheme defaults, and re-applies on theme changes.
 */
export class ThemeClearColorSync {
    private gl: WebGLRenderingContext | null = null;
    private themeMediaQuery: MediaQueryList | null = null;
    private handleThemeChange: (() => void) | null = null;
    private uiLightThemeValue = 0;

    constructor(private readonly onChanged: () => void) {}

    /** 1 when the UI is in light theme, 0 in dark theme. */
    public uiLightTheme(): number {
        return this.uiLightThemeValue;
    }

    public attach(gl: WebGLRenderingContext): void {
        this.detach();
        this.gl = gl;
        this.apply();

        if (typeof window === 'undefined') {
            return;
        }

        this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.handleThemeChange = () => {
            this.apply();
        };

        if (typeof this.themeMediaQuery.addEventListener === 'function') {
            this.themeMediaQuery.addEventListener('change', this.handleThemeChange);
            return;
        }

        this.themeMediaQuery.addListener(this.handleThemeChange);
    }

    public detach(): void {
        if (this.themeMediaQuery && this.handleThemeChange) {
            if (typeof this.themeMediaQuery.removeEventListener === 'function') {
                this.themeMediaQuery.removeEventListener('change', this.handleThemeChange);
            } else {
                this.themeMediaQuery.removeListener(this.handleThemeChange);
            }
        }
        this.themeMediaQuery = null;
        this.handleThemeChange = null;
        this.gl = null;
    }

    private apply(): void {
        this.onChanged();
        const isDarkTheme = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.uiLightThemeValue = isDarkTheme ? 0 : 1;

        if (!this.gl) {
            return;
        }

        const [r, g, b] = resolveThemeClearColor();
        this.gl.clearColor(r, g, b, 1.0);
    }
}

function resolveThemeClearColor(): [number, number, number] {
    if (typeof window === 'undefined') {
        return [0.06, 0.08, 0.14];
    }

    const rootStyle = window.getComputedStyle(document.documentElement);
    const colorToken = rootStyle.getPropertyValue('--surface-canvas').trim();
    const parsed = parseCssColorToRgb(colorToken);
    if (parsed) {
        return parsed;
    }

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? [0.06, 0.08, 0.14] : [0.86, 0.9, 0.94];
}

function parseCssColorToRgb(colorValue: string): [number, number, number] | null {
    if (!colorValue) {
        return null;
    }

    const hexMatch = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(colorValue);
    if (hexMatch) {
        const rawHex = hexMatch[1];
        const hex = rawHex.length === 3
            ? rawHex.split('').map((ch) => `${ch}${ch}`).join('')
            : rawHex;

        const intValue = Number.parseInt(hex, 16);
        const red = ((intValue >> 16) & 255) / 255;
        const green = ((intValue >> 8) & 255) / 255;
        const blue = (intValue & 255) / 255;
        return [red, green, blue];
    }

    const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(colorValue);
    if (!rgbMatch) {
        return null;
    }

    const channels = rgbMatch[1]
        .split(',')
        .map((part) => Number.parseFloat(part.trim()))
        .filter((value) => Number.isFinite(value));

    if (channels.length < 3) {
        return null;
    }

    return [
        Math.max(0, Math.min(255, channels[0])) / 255,
        Math.max(0, Math.min(255, channels[1])) / 255,
        Math.max(0, Math.min(255, channels[2])) / 255,
    ];
}
