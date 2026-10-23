// Single source of truth for "who may do what".
// MessageHandler consults this BEFORE running any event handler, so a client that
// bypasses the UI and emits the event manually is still rejected.
export const PERMISSIONS = {
  host: new Set([
    'play',
    'pause',
    'seek',
    'change_video',
    'assign_role',
    'remove_participant',
    'transfer_host',
    'resolve_request',
    'chat_message',
    'update_profile',
    'send_reaction',
  ]),
  moderator: new Set([
    'play',
    'pause',
    'seek',
    'change_video',
    'resolve_request',
    'chat_message',
    'update_profile',
    'send_reaction',
  ]),
  // Participants can only chat and ASK for changes; they cannot apply them.
  participant: new Set(['request_action', 'chat_message', 'update_profile', 'send_reaction']),
};

// Returns true if a user with `role` is allowed to perform `action`.
export function can(role, action) {
  return PERMISSIONS[role].has(action);
}

// Human-friendly text for the "You don't have permission to ..." error.
export const ACTION_LABELS = {
  play: 'play the video',
  pause: 'pause the video',
  seek: 'seek the video',
  change_video: 'change the video',
  assign_role: 'assign roles',
  remove_participant: 'remove participants',
  transfer_host: 'transfer host',
  request_action: 'request changes',
  resolve_request: 'approve or reject requests',
  chat_message: 'chat',
  update_profile: 'change your profile',
  send_reaction: 'send reactions',
};
