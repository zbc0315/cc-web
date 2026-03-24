import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';

type Theme = 'dark' | 'light' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolved: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolved: 'dark',
  setTheme: () => {},
});

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Subscribe to OS theme changes reactively */
function useSystemTheme(): 'dark' | 'light' {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => getSystemTheme(),
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => getStorage(STORAGE_KEYS.theme, 'system') as Theme,
  );

  const systemTheme = useSystemTheme();
  const resolved = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
  }, [resolved]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    setStorage(STORAGE_KEYS.theme, t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
