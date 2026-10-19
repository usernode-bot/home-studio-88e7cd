# The P2P collaboration protocol

Collaboration is optional and off by default. When a person hosts a room,
their browser becomes the **host** of a star: every guest talks to the
host over one reliable, ordered WebRTC data channel, and nothing goes
through any server (the optional signaling relay sees connection setup
only). The code lives in [`web/src/net/`](../web/src/net/).

## Roles and rooms

- The **host** made the room. It sequences every edit (below), answers
  state requests, and admits guests.
- A **guest** joins by room key. It applies only what the host relays.
- A room is up to 8 peers. Peer ids are random; display names travel in
  the hello and are what people see.

Two ways to find each other, both keyed by a room key the host drew:

1. **Manual** — copy-paste connection codes. The offer and answer travel
   as codes a person pastes to the other. Zero infrastructure, exactly
   two peers with the fixed ids `host` and `guest`.
2. **Node** — a WebSocket on a self-hosted node
   ([`selfhost/signal.js`](../selfhost/signal.js)) relays signaling for
   the whole room. The node stamps each message with the sender's id,
   forwards a join to everyone else in the room (the host then offers to
   the newcomer), and forwards offer/answer/candidate messages to the
   person they name. It never sees edits.

A person's identity is one id shared by their signaling socket and their
session; the host admits peers by it. The room key addresses the room and
never travels inside the protocol — whoever has the key can join, which
is why it is long and shown as groups.

## Edits: diff, validate, sequence, apply

The app owns the document; the session only carries edits.

1. **Diff.** A finished gesture (or discrete edit) is diffed against the
   page's previous state into ops — `add`, `del`, `set` (a field patch),
   `move`, `ord` (an order change), plus the page and document level
   `pageAdd`, `pageDel`, `pageSet`, `docSet`.
2. **Validate.** Every incoming message is cleaned and capped
   (`validateMessage`): known op type, id lists of strings, numeric
   fields finite, element counts and text lengths under caps, presence
   rounded. Anything that fails is dropped, never half-applied. A batch
   with one bad op is dropped whole.
3. **Sequence.** The host numbers every batch it relays: 1, 2, 3, … —
   its own edits and every guest's edits, in the order it applied them.
   Every open peer receives each batch, including the sender (a sender
   hears its own echo, which is how it stays in step without
   re-applying).
4. **Apply.** A guest applies a relayed batch only when its sequence is
   exactly the next one it expects. A gap means a batch was missed while
   the connection flapped: the guest asks for the full page state, the
   host answers with a snapshot carrying its current sequence, and the
   room resumes in step.

Concurrent edits carry a Lamport clock (count, ties broken by peer id),
which is what orders merged history on a rejoin.

## Presence and cursors

Each peer sends what it is doing up to 10 times a second: cursor position
(whole pixels), the page it is on, what it selected. Presence is capped
small and never persisted; a peer that stops sending keeps its last known
position.

## Leaving, rejoining, and what wins

A guest that leaves takes nothing with it. Deleting an element records a
**tombstone** on both sides (the deleter's own, the peers' received), so
a delete can survive the rejoin merge: when someone rejoins, the two
document states are merged element by element —

- a **deletion beats an edit** (the element stays gone),
- pages are unioned (a page only one side has is adopted),
- an element both sides edited keeps the copy with the newer
  `updatedAt`, and the app notes which side each adopted change came
  from.

A snapshot of the design as it was when the room started is kept in
version history, so joining a room is undoable like any other edit.

## Known limitation: images are not transferred

The data channel carries **edits, not image bytes**. If one person adds
or edits an image, the other sees the element with a placeholder where
the picture would be: their device has no copy of that image, and the
protocol deliberately does not ship blobs peer-to-peer. To share images,
sync the design to a store both people can reach (Remote storage), or
publish it; the images ride along there, content-addressed.

## Caps

Message sizes and counts are capped in [`protocol.js`](../web/src/net/protocol.js):
one ops message 512 KB, presence 4 KB, 200 elements per op, 20 000
characters of text, names 200 characters. A batch too large for one
message is split; a single op too large to ever fit is skipped for the
room (with a notice) while the local edit stays. The full document state
is capped at four times the ops message size; a design larger than that
is too large to send to a peer.