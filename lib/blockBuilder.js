/**
 * Scash Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Builds Scash blocks from a getblocktemplate answer: the coinbase transaction (BIP34 height, extranonce, the pool's output and
 * the SegWit witness commitment), the merkle root, the 112 byte header and the serialized block for submitblock.
 *
 * Scash header (little endian): version 4 | previous block hash 32 | merkle root 32 | time 4 | bits 4 | nonce 4 | hashRandomX 32.
 * Miners get the header with hashRandomX zero (that is what RandomX is fed with); a solved block carries the RandomX hash there.
 **/
let crypto = require('crypto');

const HEADER_SIZE = 112;
const NONCE_OFFSET = 76;

function sha256d (buf) {
	return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}
exports.sha256d = sha256d;

function reverse (buf) {
	return Buffer.from(buf).reverse();
}

function varint (n) {
	if (n < 0xfd) return Buffer.from([n]);
	if (n <= 0xffff) { let b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
	if (n <= 0xffffffff) { let b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b; }
	let b = Buffer.alloc(9); b[0] = 0xff; b.writeBigUInt64LE(BigInt(n), 1); return b;
}
exports.varint = varint;

/** a script number push for the BIP34 height (minimal encoding) */
function heightPush (height) {
	let bytes = [];
	let n = height;
	while (n > 0) { bytes.push(n & 0xff); n = Math.floor(n / 256); }
	if (bytes.length && (bytes[bytes.length - 1] & 0x80)) bytes.push(0);
	if (height >= 1 && height <= 16) return Buffer.from([0x50 + height]);
	return Buffer.concat([Buffer.from([bytes.length]), Buffer.from(bytes)]);
}
exports.heightPush = heightPush;

/**
 * Coinbase transaction. Returns {txid (internal byte order), full (hex with witness), legacy (hex without)}.
 *   scriptSig = <height> <extranonce> [<tag>]; outputs: pool script with the whole coinbasevalue, then the witness commitment.
 **/
exports.buildCoinbase = function (template, poolScriptHex, extraNonce, tag) {
	let scriptSig = Buffer.concat([heightPush(template.height), Buffer.from([extraNonce.length]), extraNonce].concat(tag ? [Buffer.from([tag.length]), Buffer.from(tag)] : []));
	if (scriptSig.length < 2 || scriptSig.length > 100) throw new Error('coinbase script of ' + scriptSig.length + ' bytes');

	let value = Buffer.alloc(8);
	value.writeBigUInt64LE(BigInt(template.coinbasevalue));
	let poolScript = Buffer.from(poolScriptHex, 'hex');
	let outputs = [Buffer.concat([value, varint(poolScript.length), poolScript])];
	let commitment = template.default_witness_commitment ? Buffer.from(template.default_witness_commitment, 'hex') : null;
	if (commitment) outputs.push(Buffer.concat([Buffer.alloc(8), varint(commitment.length), commitment]));

	let version = Buffer.alloc(4); version.writeInt32LE(2);
	let input = Buffer.concat([Buffer.alloc(32), Buffer.from('ffffffff', 'hex'), varint(scriptSig.length), scriptSig, Buffer.from('ffffffff', 'hex')]);
	let body = Buffer.concat([varint(1), input, varint(outputs.length)].concat(outputs));
	let locktime = Buffer.alloc(4);
	let legacy = Buffer.concat([version, body, locktime]);
	let full = commitment
		? Buffer.concat([version, Buffer.from('0001', 'hex'), body, Buffer.from([1, 32]), Buffer.alloc(32), locktime])   // witness: one item, the 32 zero byte reserved value
		: legacy;
	return {txid: sha256d(legacy), legacy: legacy.toString('hex'), full: full.toString('hex')};
};

/** merkle root (internal byte order) of a list of txids (internal byte order) */
exports.merkleRoot = function (txids) {
	let level = txids.slice();
	if (!level.length) throw new Error('no transactions');
	while (level.length > 1) {
		if (level.length % 2) level.push(level[level.length - 1]);
		let next = [];
		for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1]])));
		level = next;
	}
	return level[0];
};

/**
 * The job for miners out of a template.
 *   {header (Buffer 112, hashRandomX zero), coinbase, transactions (hex list), height, time, bits (number), target (BigInt), prevHash}
 **/
exports.buildJob = function (template, poolScriptHex, extraNonce, tag) {
	let coinbase = exports.buildCoinbase(template, poolScriptHex, extraNonce, tag);
	let txids = [coinbase.txid].concat((template.transactions || []).map(function (t) { return reverse(Buffer.from(t.txid || t.hash, 'hex')); }));
	let merkle = exports.merkleRoot(txids);

	let header = Buffer.alloc(HEADER_SIZE);
	header.writeInt32LE(template.version, 0);
	reverse(Buffer.from(template.previousblockhash, 'hex')).copy(header, 4);
	merkle.copy(header, 36);
	header.writeUInt32LE(template.curtime, 68);
	let bits = parseInt(template.bits, 16);
	header.writeUInt32LE(bits, 72);
	// nonce (76) and hashRandomX (80..111) stay zero
	return {
		header: header,
		coinbase: coinbase,
		transactions: (template.transactions || []).map(function (t) { return t.data; }),
		height: template.height,
		time: template.curtime,
		bits: bits,
		target: BigInt('0x' + template.target),
		prevHash: template.previousblockhash
	};
};

/** the serialized block for submitblock: header with the nonce and the RandomX hash, coinbase, the template's transactions */
exports.serializeBlock = function (job, nonceHexLE, randomxHashHex) {
	let header = Buffer.from(job.header);
	Buffer.from(nonceHexLE, 'hex').copy(header, NONCE_OFFSET);
	Buffer.from(randomxHashHex, 'hex').copy(header, 80);
	let count = 1 + job.transactions.length;
	return header.toString('hex') + varint(count).toString('hex') + job.coinbase.full + job.transactions.join('');
};

exports.HEADER_SIZE = HEADER_SIZE;
exports.NONCE_OFFSET = NONCE_OFFSET;
