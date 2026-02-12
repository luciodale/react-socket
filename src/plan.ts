// You need to only store to local storage the failed messages. ATM, every conversation message is going to local storage. That's bad.
// on refresh, local storage gets cleared and I lose my failed messages. That's bad. Messages are cleared when:
// 1. the user sends a new message that succeeds (it's sent to the server and the server confirms it)
// 2. the queued messages are sent to the server and the server confirms them. If some are not confirmed, keep them in local storage.
// A reminder that local storage is used as a queue to manage ONLY FAILED MESSAGES. and this messages will always be at the newest position in the total messages. Therefore:
// 1. The logic should be that on subscribe the server returns a dump of all messages for that channel, and we can simply push the failed messages at the end.
// 2. The moment a user sends a new message that succeeds, the failed messages are forever dismissed.
// Add a configurable delay in the msw socket for when I subscribe, so I can see the pending status.
