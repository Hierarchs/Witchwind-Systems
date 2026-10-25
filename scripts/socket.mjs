import { MODULE_ID, L } from "./config.mjs";

/*
 * Two kinds of message go over the module's socket:
 * - requests a player asks the active GM to carry out (only uploading a picture, for players who can't upload),
 *   answered with a response addressed back to them;
 * - broadcasts any GM sends to everyone (showing a quest, note or map to the whole table).
 */

const EVENT = `module.${MODULE_ID}`;
const TIMEOUT = 30000;

/** Request handlers, run on the active GM's client: action -> async (payload, user) => result. */
const handlers = {};

/** Broadcast listeners, run on every other client: action -> (payload, user) => void. */
const listeners = {};

/** Requests waiting for the GM's answer, by request id. */
const pending = new Map();

export function registerSocket() {
  game.socket.on(EVENT, onMessage);
}

export function handle(action, fn) {
  handlers[action] = fn;
}

export function listen(action, fn) {
  listeners[action] = fn;
}

/** Ask the active GM to do something, resolving with the GM's result. A GM's own requests run locally. */
export function request(action, payload) {
  if ( game.user.isActiveGM ) return handlers[action](payload, game.user);
  if ( !game.users.activeGM ) return Promise.reject(new Error(game.i18n.localize(`${L}.Errors.NoGM`)));
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(game.i18n.localize(`${L}.Errors.NoAnswer`)));
    }, TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    game.socket.emit(EVENT, { type: "request", id, action, payload, from: game.user.id });
  });
}

/** Send something to every other connected client. */
export function broadcast(action, payload) {
  game.socket.emit(EVENT, { type: "broadcast", action, payload, from: game.user.id });
}

async function onMessage(message) {
  switch ( message?.type ) {
    case "request": {
      if ( !game.user.isActiveGM ) return;
      const user = game.users.get(message.from);
      const response = { type: "response", id: message.id, to: message.from };
      try {
        if ( !user || !handlers[message.action] ) throw new Error(`Unknown request "${message.action}"`);
        response.result = await handlers[message.action](message.payload, user);
      } catch(err) {
        response.error = err.message;
      }
      game.socket.emit(EVENT, response);
      break;
    }
    case "response": {
      if ( message.to !== game.user.id ) return;
      const waiting = pending.get(message.id);
      if ( !waiting ) return;
      pending.delete(message.id);
      clearTimeout(waiting.timer);
      if ( message.error ) waiting.reject(new Error(message.error));
      else waiting.resolve(message.result);
      break;
    }
    case "broadcast": {
      const user = game.users.get(message.from);
      // Only GMs may broadcast, so a player can't pop windows open on everyone else's screen.
      if ( user?.isGM ) listeners[message.action]?.(message.payload, user);
      break;
    }
  }
}
