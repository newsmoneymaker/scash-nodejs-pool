# Changes

## 1.0.0

* First release: Satoshi Cash (SCASH, Bitcoin Core 27 with RandomX) pool derived from veil-nodejs-pool, qwc-nodejs-pool and epic-nodejs-pool.
* The pool builds the blocks itself from `getblocktemplate` (`lib/blockBuilder.js`): coinbase with the BIP34 height, an extranonce, the pool's output and the SegWit
  witness commitment, the merkle root, the 112 byte Scash header; a solved block is sent with `submitblock`.
* Proof of work as in the Scash protocol spec: RandomX 1.2.1 with the Scash Argon2 salt, key = SHA256d of the epoch string (7 days), input = the 112 byte header
  with hashRandomX zero, blocks judged by the RandomX commitment. The helper `hasher/rxhash --scash` answers the hash and the commitment; it is built with the
  RandomX library of the node itself.
* Payments and unlocker as in Bitcoin based pools (`sendmany`, `gettransaction`, coinbase maturity 100), native SegWit addresses (`scash1q...`, 45 characters).
* The variable difficulty of a worker is remembered across reconnects (`poolServer.diffMemoryMinutes`, default 15).
* Tests: address handling, a simulated node (`test-scash-pool.js`, `test-scash-payments.js`), real mainnet blocks (`test-real-blocks.js`) and an END TO END test
  against a real `scashd` on regtest (`test-scash-regtest.js`): a block built by the pool is accepted by the node, optionally mined by a real miner.
* Not yet checked on a block found on mainnet: the payout with the real wallet (`sendmany` with `subtractfeefrom`).
