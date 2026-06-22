export const SESSION_MESSAGE_LAYOUT_CHANGED_EVENT = 'session-message-layout-changed';

export type SessionMessageLayoutChangedReason =
  | 'thinking-block-toggle'
  | 'thinking-block-auto-collapse'
  | 'streaming-ended';

export interface SessionMessageLayoutChangedDetail {
  reason: SessionMessageLayoutChangedReason;
  itemKey?: string;
  itemIndex?: number;
}
