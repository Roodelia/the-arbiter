import { useEffect } from 'react';
import { Platform } from 'react-native';

// The official https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js builds its floating
// button/popup inside a `window.addEventListener('DOMContentLoaded', ...)` handler. That event
// has already fired long before this mounts dynamically from React, so the handler would never
// run — this manually re-dispatches DOMContentLoaded once the script has loaded to trigger it,
// and tracks every node the script adds to <body> so it can be torn down again on unmount.
type BuyMeACoffeeWidgetProps = {
  id?: string;
  description?: string;
  message?: string;
  color?: string;
  position?: 'Left' | 'Right';
  xMargin?: number;
  yMargin?: number;
  // The widget's own message popup shows 500ms after it's built and auto-hides 5s after that —
  // fixed inside the vendor script, not exposed via data-*. Delaying when we build the widget
  // (below) is the only lever we have, so this shifts the button + message entrance together.
  entranceDelayMs?: number;
};

export function BuyMeACoffeeWidget({
  id = 'manajudge',
  description = 'Support me on Buy me a coffee!',
  message = '"Hope this helped! If it saved you a headache or a table argument, a coffee keeps ManaJudge free for the next player who needs one."',
  color = '#a67c2e',
  position = 'Right',
  xMargin = 18,
  yMargin = 18,
  entranceDelayMs = 0,
}: BuyMeACoffeeWidgetProps) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const bodyChildrenBefore = new Set(Array.from(document.body.children));
    let script: HTMLScriptElement | null = null;

    const inject = () => {
      script = document.createElement('script');
      script.dataset.name = 'BMC-Widget';
      script.dataset.cfasync = 'false';
      script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js';
      script.dataset.id = id;
      script.dataset.description = description;
      script.dataset.message = message;
      script.dataset.color = color;
      script.dataset.position = position;
      script.dataset.x_margin = String(xMargin);
      script.dataset.y_margin = String(yMargin);
      script.onload = () => {
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
      };

      document.body.appendChild(script);
    };

    const timer = setTimeout(inject, entranceDelayMs);

    return () => {
      clearTimeout(timer);
      Array.from(document.body.children)
        .filter((el) => !bodyChildrenBefore.has(el))
        .forEach((el) => el.remove());
    };
  }, [id, description, message, color, position, xMargin, yMargin, entranceDelayMs]);

  return null;
}
