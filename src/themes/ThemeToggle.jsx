import { useTheme } from './ThemeContext';
import './ThemeToggle.css';

const LABELS = { modern: 'Modern', win95: 'Win95', system7: 'Mac' };

export default function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <div className="bs-theme-toggle" role="group" aria-label="Theme">
      {themes.map((t) => (
        <button
          key={t}
          type="button"
          className={`bs-theme-seg${theme === t ? ' active' : ''}`}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
        >{LABELS[t]}</button>
      ))}
    </div>
  );
}
