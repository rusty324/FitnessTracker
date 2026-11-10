// Desktop vs phone, decided the same way as the CSS: a wide window AND a
// mouse. A touch-only tablet, however wide, keeps the phone layout.

export const DESKTOP_QUERY = '(min-width: 960px) and (hover: hover) and (pointer: fine)';
const mq = typeof matchMedia === 'function' ? matchMedia(DESKTOP_QUERY) : null;
export const isDesktop = () => !!mq?.matches;
export function onLayoutChange(fn) {
  mq?.addEventListener?.('change', fn);
}
