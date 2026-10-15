import { useState } from 'react';
import { formatDisplayNumber, isFormattedDisplayEcho } from '../utils/displayUnit';

function rawOf(event) {
  if (event && typeof event === 'object' && event.target) return event.target.value;
  return event == null ? '' : String(event);
}

/**
 * Text box for a calculated number. The box shows `formatDisplayNumber`.
 * While this box is focused, keystrokes stay as typed. An echo of the
 * formatted value — including a touch-edit commit of a field the user did
 * not change — does not call `onChange`.
 */
export function useDisplayNumber(value, onChange) {
  const [draft, setDraft] = useState(null);
  const partial = value === '' || value === '-' || value === '.';
  const formatted = partial
    ? value
    : (Number.isFinite(Number(value)) ? formatDisplayNumber(value) : (value ?? ''));
  const shown = draft != null ? draft : (formatted ?? '');
  return {
    value: shown,
    onFocus: (event) => {
      if (event?.target && typeof document !== 'undefined' && event.target !== document.activeElement) return;
      setDraft(formatted ?? '');
    },
    onBlur: () => setDraft(null),
    endDraft: () => setDraft(null),
    onChange: (event) => {
      const raw = rawOf(event);
      const focused = !event?.target
        || typeof document === 'undefined'
        || event.target === document.activeElement;
      if (raw === '' || raw === '-' || raw === '.') {
        if (focused) setDraft(raw);
        else setDraft(null);
        onChange?.(raw);
        return;
      }
      if (isFormattedDisplayEcho(value, raw)) {
        if (focused) setDraft(null);
        return;
      }
      if (focused) setDraft(raw);
      else setDraft(null);
      onChange?.(raw);
    },
  };
}
