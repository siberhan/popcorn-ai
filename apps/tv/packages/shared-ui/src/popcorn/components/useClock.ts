import { useEffect, useState } from 'react';

const CLOCK_MS = 30000;

const twoDigits = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const clockText = () => {
  const now = new Date();
  return `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
};

/** HH:MM, 24 h, refreshed every 30 s. */
export function useClock(): string {
  const [text, setText] = useState(clockText);
  useEffect(() => {
    const id = setInterval(() => setText(clockText()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  return text;
}
