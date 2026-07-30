import {
  observeElementRect as observeTanStackElementRect,
  type Rect,
  type Virtualizer,
} from '@tanstack/react-virtual';

export type ElementRectObserver<
  TScrollElement extends Element,
  TItemElement extends Element,
> = (
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (rect: Rect) => void,
) => void | (() => void);

export interface RefreshableElementRectObserver<
  TScrollElement extends Element,
  TItemElement extends Element,
> {
  observeElementRect: ElementRectObserver<TScrollElement, TItemElement>;
  refresh: () => boolean;
}

/**
 * Wraps TanStack Virtual's own rect observer with an imperative refresh entry.
 *
 * `virtualizer.measure()` only clears item-size measurements; it does not read
 * the scroll element's current dimensions. WebViews can miss a hidden->visible
 * ResizeObserver delivery, leaving `scrollRect.height` stuck at zero until a
 * later message changes layout. The returned `refresh()` reuses TanStack's
 * callback so the virtualizer receives the current DOM rect without adding a
 * second observer.
 */
export function createRefreshableElementRectObserver<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  baseObserver: ElementRectObserver<TScrollElement, TItemElement> = observeTanStackElementRect,
): RefreshableElementRectObserver<TScrollElement, TItemElement> {
  let activeRefresh: (() => boolean) | null = null;

  const observeElementRect: ElementRectObserver<TScrollElement, TItemElement> = (instance, callback) => {
    let disposed = false;
    const refresh = () => {
      if (disposed) return false;

      const scrollElement = instance.scrollElement;
      if (!scrollElement) return false;

      const boundingRect = scrollElement.getBoundingClientRect();
      const width = Math.round(boundingRect.width > 0 ? boundingRect.width : scrollElement.clientWidth);
      const height = Math.round(boundingRect.height > 0 ? boundingRect.height : scrollElement.clientHeight);
      callback({ width, height });
      return height > 0;
    };

    activeRefresh = refresh;
    const stopObserving = baseObserver(instance, callback);

    return () => {
      disposed = true;
      if (activeRefresh === refresh) {
        activeRefresh = null;
      }
      stopObserving?.();
    };
  };

  return {
    observeElementRect,
    refresh: () => activeRefresh?.() ?? false,
  };
}
