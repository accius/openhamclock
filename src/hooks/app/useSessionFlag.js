import { useEffect, useState } from 'react';
import { getFlag, SESSION_FLAG_EVENT } from '../../utils/sessionFlags.js';

/** Subscribe to one session flag (see utils/sessionFlags.js). */
export default function useSessionFlag(name) {
  const [value, setValue] = useState(() => getFlag(name));
  useEffect(() => {
    setValue(getFlag(name));
    const onChange = (e) => {
      if (e.detail?.name === name) setValue(e.detail.value);
    };
    window.addEventListener(SESSION_FLAG_EVENT, onChange);
    return () => window.removeEventListener(SESSION_FLAG_EVENT, onChange);
  }, [name]);
  return value;
}
