// An error whose message is safe to show to the end user (permission denied, bad input, ...).
// Anything that is NOT a RoomError is treated as a bug: logged on the server, generic message to the client.
export class RoomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoomError';
  }
}
