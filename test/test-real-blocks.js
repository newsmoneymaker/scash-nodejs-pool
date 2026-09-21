// Checks the hashing of the pool against real Scash mainnet blocks: for each block the RandomX hash and the RandomX commitment of its 112 byte header
// (hashRandomX zeroed, key = SHA256d("Scash/RandomX/Epoch/<time / 7 days>")) must equal `rx_hash` and `rx_cm` reported by scashd, and the commitment must
// meet the block's target. Needs the helper: make -C hasher RANDOMX=...   Run: node test/test-real-blocks.js
const {spawn} = require('child_process');
const path = require('path');
const crypto = require('crypto');
const data = require('./real-blocks.json');
const helper = spawn(path.join(__dirname, '..', 'hasher', 'rxhash'), ['--scash', '--threads', '1', '--light'], {stdio: ['pipe', 'pipe', 'inherit']});
helper.stdout.setEncoding('utf8');
let buf = '', waiting = null;
helper.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (waiting) { const w = waiting; waiting = null; w(line.split(' ')); } } });
const ask = line => new Promise(res => { waiting = res; helper.stdin.write(line + '\n'); });
const sha256d = b => crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest();
const compactToTarget = bits => { const e = bits >>> 24, m = BigInt(bits & 0x7fffff); return e <= 3 ? m >> BigInt(8 * (3 - e)) : m << BigInt(8 * (e - 3)); };
(async () => {
	let failed = 0, key = null;
	for (const b of data.blocks) {
		const header = Buffer.from(b.header, 'hex');
		header.fill(0, 80, 112);
		const time = header.readUInt32LE(68), bits = header.readUInt32LE(72);
		const k = sha256d(Buffer.from('Scash/RandomX/Epoch/' + Math.floor(time / (7 * 24 * 3600)))).toString('hex');
		if (k !== key) { key = k; await ask('K ' + key); }
		const r = await ask('H x ' + header.toString('hex'));
		const cm = BigInt('0x' + Buffer.from(r[3], 'hex').reverse().toString('hex'));
		// the node prints uint256 values in display order (bytes reversed)
		const rev = hex => Buffer.from(hex, 'hex').reverse().toString('hex');
		const ok = rev(r[2]) === b.rx_hash && rev(r[3]) === b.rx_cm && r[2] === Buffer.from(b.header, 'hex').slice(80, 112).toString('hex') && cm <= compactToTarget(bits);
		if (!ok) failed++;
		console.log((ok ? 'PASS  ' : 'FAIL  ') + 'block ' + b.height + ' (epoch ' + Math.floor(time / (7 * 24 * 3600)) + ') RandomX hash and commitment equal the node\'s (and the hash in the header), commitment meets the target');
	}
	helper.stdin.write('Q\n');
	console.log(failed ? '\n' + failed + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
	process.exit(failed ? 1 : 0);
})();
