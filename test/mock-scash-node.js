// Mock of scashd for the pool tests: Bitcoin style JSON-RPC (HTTP, basic auth ignored) with getbestblockhash, getblocktemplate, submitblock,
// getblockhash, getblockcount, getblockheader. A submitted block is verified with the real RandomX helper (--scash), so a solution has to be real:
// header.hashRandomX must be the RandomX hash of the header and the RandomX commitment must not be above the target.
// node mock-scash-node.js <port> <bits hex> [hasherPath]
const http = require('http');
const crypto = require('crypto');
const {spawn} = require('child_process');
const path = require('path');

const PORT = parseInt(process.argv[2] || '25556');
let BITS = parseInt(process.argv[3] || '1f00ffff', 16);
const HASHER = process.argv[4] || path.join(__dirname, '..', 'hasher', 'rxhash');
const EPOCH = 7 * 24 * 60 * 60;

const sha256d = b => crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest();
function compactToTarget (bits) {
	const exponent = bits >>> 24, mantissa = BigInt(bits & 0x007fffff);
	return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
}
let TARGET = compactToTarget(BITS);
const keyOf = time => sha256d(Buffer.from('Scash/RandomX/Epoch/' + Math.floor(time / EPOCH))).toString('hex');

let height = 150000;
let tip = crypto.randomBytes(32).toString('hex');           // display order
const blocks = {};
blocks[height] = tip;
let accepted = 0, submitted = 0, lastBlock = null;

// verification helper: the key changes with the epoch of the block time, so one process per key
const hasher = spawn(HASHER, ['--scash', '--threads', '1', '--light']);
hasher.stdout.setEncoding('utf8');
let hbuf = '', hwait = {}, currentKey = null, keyWaiters = [], keyBusy = false;
hasher.stdout.on('data', function (d) {
	hbuf += d; let i;
	while ((i = hbuf.indexOf('\n')) !== -1) {
		const parts = hbuf.slice(0, i).split(' '); hbuf = hbuf.slice(i + 1);
		if (parts[0] === 'K') { keyBusy = false; keyWaiters.forEach(f => f()); keyWaiters = []; }
		else if (parts[0] === 'H' && hwait[parts[1]]) { hwait[parts[1]]({r: parts[2], cm: parts[3]}); delete hwait[parts[1]]; }
	}
});
let hid = 0;
function withKey (key, fn) {
	if (currentKey === key && !keyBusy) return fn();
	keyWaiters.push(function () { fn(); });
	if (!keyBusy) { keyBusy = true; currentKey = key; hasher.stdin.write('K ' + key + '\n'); }
}
function hashHeader (hex, key, cb) {
	withKey(key, function () { const id = 'm' + (++hid); hwait[id] = cb; hasher.stdin.write('H ' + id + ' ' + hex + '\n'); });
}

function template () {
	const time = Math.floor(Date.now() / 1000);
	const commitment = '6a24aa21a9ed' + crypto.randomBytes(32).toString('hex');
	// one fake transaction so that the merkle tree is not trivial (the mock does not validate transactions)
	const fake = crypto.randomBytes(60);
	return {
		version: 0x20000000, rules: ['csv', 'segwit'], previousblockhash: tip, curtime: time, mintime: time - 600, bits: BITS.toString(16).padStart(8, '0'),
		target: TARGET.toString(16).padStart(64, '0'), height: height + 1, coinbasevalue: 5000000000, default_witness_commitment: commitment,
		rx_epoch_duration: EPOCH, noncerange: '00000000ffffffff', sizelimit: 4000000, weightlimit: 4000000, sigoplimit: 80000,
		transactions: [{data: fake.toString('hex'), txid: sha256d(fake).reverse().toString('hex'), hash: sha256d(fake).reverse().toString('hex'), fee: 1000, sigops: 0, weight: 240}]
	};
}

function handle (method, params, cb) {
	if (method === 'getbestblockhash') return cb(null, tip);
	if (method === 'getblocktemplate') return cb(null, template());
	if (method === 'submitblock') {
		submitted++;
		const raw = Buffer.from(params[0], 'hex');
		if (raw.length < 112 + 1 + 60) return cb({code: -22, message: 'Block decode failed'});
		const header = Buffer.from(raw.slice(0, 112));
		const rx = Buffer.from(header.slice(80, 112)).toString('hex');
		header.fill(0, 80, 112);
		const prev = Buffer.from(header.slice(4, 36)).reverse().toString('hex');
		if (prev !== tip) return cb(null, 'inconclusive');
		const time = header.readUInt32LE(68), bits = header.readUInt32LE(72);
		hashHeader(header.toString('hex'), keyOf(time), function (h) {
			if (h.r !== rx) return cb(null, 'bad-randomx-hash');
			const cm = BigInt('0x' + Buffer.from(h.cm, 'hex').reverse().toString('hex'));
			if (cm > compactToTarget(bits)) return cb(null, 'high-hash');
			height++;
			const full = Buffer.from(header); Buffer.from(rx, 'hex').copy(full, 80);
			tip = sha256d(full).reverse().toString('hex');
			blocks[height] = tip;
			lastBlock = params[0];
			accepted++;
			cb(null, null);
		});
		return;
	}
	if (method === 'getblockcount') return cb(null, height);
	if (method === 'getblockhash') return blocks[params[0]] ? cb(null, blocks[params[0]]) : cb({code: -8, message: 'Block height out of range'});
	if (method === 'getblockheader') return cb(null, {hash: tip, height, time: Math.floor(Date.now() / 1000) - 30, difficulty: 1234.5});
	if (method === 'mock_setbits') { BITS = parseInt(params[0], 16); TARGET = compactToTarget(BITS); return cb(null, true); }
	if (method === 'mock_state') return cb(null, {height, tip, accepted, submitted, lastBlock});
	cb({code: -32601, message: 'Method not found'});
}

http.createServer(function (req, res) {
	let body = '';
	req.on('data', d => body += d);
	req.on('end', function () {
		let msg; try { msg = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
		handle(msg.method, msg.params || [], function (err, result) {
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({result: err ? null : result, error: err || null, id: msg.id}));
		});
	});
}).listen(PORT, '127.0.0.1', () => console.log('mock scashd on', PORT, 'bits', BITS.toString(16), 'target hashes ~', Number((1n << 256n) / (TARGET + 1n))));
