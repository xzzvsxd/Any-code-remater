import { describe, expect, test, vi } from 'vitest';
import { Virtualizer, type Rect } from '@tanstack/react-virtual';
import {
  createRefreshableElementRectObserver,
  type ElementRectObserver,
} from '../refreshableElementRectObserver';

describe('createRefreshableElementRectObserver', () => {
  test('pushes a restored DOM viewport through the TanStack callback and recovers virtual items', () => {
    let clientWidth = 0;
    let clientHeight = 0;
    const scrollElement = {
      get clientWidth() {
        return clientWidth;
      },
      get clientHeight() {
        return clientHeight;
      },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    } as unknown as HTMLDivElement;

    const virtualizer = new Virtualizer<HTMLDivElement, HTMLElement>({
      count: 3,
      getScrollElement: () => scrollElement,
      estimateSize: () => 100,
      scrollToFn: () => {},
      observeElementRect: () => () => {},
      observeElementOffset: () => () => {},
    });
    virtualizer.scrollElement = scrollElement;
    virtualizer.scrollRect = { width: 0, height: 0 };

    const callback = vi.fn((rect: Rect) => {
      virtualizer.scrollRect = rect;
    });
    const stopBaseObserver = vi.fn();
    const baseObserver: ElementRectObserver<HTMLDivElement, HTMLElement> = () => stopBaseObserver;
    const observer = createRefreshableElementRectObserver(baseObserver);
    const stopObserving = observer.observeElementRect(virtualizer, callback);

    expect(virtualizer.getVirtualItems()).toEqual([]);
    expect(observer.refresh()).toBe(false);
    expect(callback).toHaveBeenLastCalledWith({ width: 0, height: 0 });

    clientWidth = 800;
    clientHeight = 600;
    expect(observer.refresh()).toBe(true);
    expect(callback).toHaveBeenLastCalledWith({ width: 800, height: 600 });
    expect(virtualizer.getVirtualItems()).toHaveLength(3);

    stopObserving?.();
    expect(stopBaseObserver).toHaveBeenCalledOnce();
    expect(observer.refresh()).toBe(false);
  });
});
