/**
 * Block reward of Scash mainnet: 50 SCASH, halved every 210000 blocks (as in Bitcoin). Amounts in atomic units (1 SCASH = 1e8).
 * The fees of the transactions in a block come on top; the pool reads the exact reward of its own blocks from its wallet.
 **/
const SCASH_BASE = 100000000;

exports.minerReward = function (height) {
	if (!(height > 0)) return 0;
	let halvings = Math.floor(height / 210000);
	if (halvings >= 64) return 0;
	return Math.floor(50 * SCASH_BASE / Math.pow(2, halvings));
};
