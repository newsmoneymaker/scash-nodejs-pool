// End to end against a REAL scashd on regtest: the pool builds the block (coinbase, witness commitment, merkle root, 112 byte header) from the node's
// getblocktemplate, a miner (the RandomX helper) finds a share that is a block, the pool submits it and the node must accept it (the node checks
// the coinbase, the commitment and the RandomX hash and commitment itself). Needs scashd (regtest is started by this test in the Debian chroot of
// /root/claude/scash, or point SCASHD_CMD to a command that starts it) and the throwaway redis of test/config.test.json (flushed!).
// Run: node test/test-scash-regtest.js
const {spawn, execFileSync} = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const redis = require(path.join(__dirname, '../node_modules/redis'));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.test.json'), 'utf8'));

const CHROOT = process.env.SCASH_CHROOT || '/root/claude/scash/chroot';
if (!fs.existsSync(CHROOT + '/usr/local/bin/scashd')) { console.log('SKIP: no scashd in ' + CHROOT); process.exit(0); }
const RPC_PORT = 18461, P2P_PORT = 18462, USER = 'rt', PASS = 'rtpass';
const HASHER = path.join(__dirname, '..', 'hasher', 'rxhash');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const cleanup = () => procs.forEach(p => { try { p.kill(); } catch (e) {} });
process.on('exit', cleanup);

function rpc (method, params, wallet) {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify({jsonrpc: '1.0', id: 1, method, params: params || []});
		const req = http.request({host: '127.0.0.1', port: RPC_PORT, path: wallet ? '/wallet/' + wallet : '/', method: 'POST', auth: USER + ':' + PASS, headers: {'Content-Length': Buffer.byteLength(body)}}, res => {
			let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); j.error ? reject(new Error(JSON.stringify(j.error))) : resolve(j.result); } catch (e) { reject(e); } });
		});
		req.on('error', reject); req.end(body);
	});
}

(async () => {
	// a regtest node in the chroot (the binaries need its glibc)
	const dataDir = '/tmp/rt-' + process.pid;
	fs.mkdirSync(CHROOT + dataDir, {recursive: true});
	const node = spawn('chroot', [CHROOT, '/usr/local/bin/scashd', '-chain=scashregtest', '-datadir=' + dataDir, '-rpcport=' + RPC_PORT, '-port=' + P2P_PORT, '-rpcuser=' + USER, '-rpcpassword=' + PASS, '-listen=0', '-dnsseed=0', '-fallbackfee=0.0001', '-printtoconsole=0'], {stdio: 'ignore'}); procs.push(node);
	let up = false;
	for (let i = 0; i < 60 && !up; i++) { try { await rpc('getblockcount'); up = true; } catch (e) { await sleep(1000); } }
	check('regtest scashd is up', up);
	if (!up) process.exit(1);
	await rpc('createwallet', ['pool']);
	const poolAddress = await rpc('getnewaddress', ['', 'bech32'], 'pool');
	check('the regtest wallet gives a bech32 address with the regtest prefix', /^rscash1q/.test(poolAddress), poolAddress);
	const minerAddress = await rpc('getnewaddress', ['', 'bech32'], 'pool');
	await rpc('generatetoaddress', [1, minerAddress], 'pool');       // leaves the initial block download state of a fresh chain

	const conf = JSON.parse(JSON.stringify(cfg));
	conf.addressPrefix = 'rscash';
	conf.node = {host: '127.0.0.1', port: RPC_PORT, user: USER, password: PASS};
	conf.poolServer.poolAddress = poolAddress;
	conf.poolServer.templateRefresh = 2;
	conf.hasher = {threads: 2, args: ['--scash', '--light']};
	const file = path.join(os.tmpdir(), 'scash-regtest-pool.json');
	fs.writeFileSync(file, JSON.stringify(conf));
	const R = redis.createClient(conf.redis.port, conf.redis.host, {auth_pass: conf.redis.auth, db: conf.redis.db || 0});
	await new Promise(res => R.flushdb(res));
	const pool = spawn('node', [path.join(__dirname, '..', 'init.js'), '-config=' + file, '-module=pool'], {cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe']}); procs.push(pool);
	let poolLog = ''; pool.stdout.on('data', d => poolLog += d); pool.stderr.on('data', d => poolLog += d);

	// the miner side: the helper and a stratum client
	const mh = spawn(HASHER, ['--scash', '--threads', '2', '--light'], {stdio: ['pipe', 'pipe', 'inherit']}); procs.push(mh);
	mh.stdout.setEncoding('utf8');
	let mbuf = '', mwait = {}, mkey = null, mid = 0;
	mh.stdout.on('data', d => { mbuf += d; let i; while ((i = mbuf.indexOf('\n')) !== -1) { const p = mbuf.slice(0, i).split(' '); mbuf = mbuf.slice(i + 1); if (p[0] === 'K' && mkey) mkey(); else if (p[0] === 'H' && mwait[p[1]]) { mwait[p[1]]({r: p[2], cm: p[3]}); delete mwait[p[1]]; } } });
	const setKey = raw => new Promise(res => { mkey = res; mh.stdin.write('K ' + raw + '\n'); });
	const hashBlob = hex => new Promise(res => { const id = 'c' + (++mid); mwait[id] = res; mh.stdin.write('H ' + id + ' ' + hex + '\n'); });

	function client () {
		const sock = net.connect(conf.poolServer.ports[0].port, '127.0.0.1');
		sock.setEncoding('utf8');
		sock.on('error', () => {});
		let buf = '';
		const waiting = {};
		sock.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); if (waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; } } });
		let n = 0;
		return {sock, call: (method, params) => new Promise(res => { const id = ++n; waiting[id] = res; sock.write(JSON.stringify({id, jsonrpc: '2.0', method, params}) + '\n'); setTimeout(() => { if (waiting[id]) { delete waiting[id]; res({error: {message: 'no answer'}}); } }, 5000); })};
	}

	console.log('# pool started, waiting for jobs');
	let login, c;
	for (let i = 0; i < 90; i++) {
		c = client(); await sleep(300);
		login = await c.call('login', {login: minerAddress + '+rt', pass: 'x', agent: 'test'});
		if (login.result) break;
		c.sock.destroy(); await sleep(1000);
	}
	check('the pool serves jobs from the real node', !!(login && login.result && login.result.job), (login && login.error && login.error.message));
	if (!(login && login.result && login.result.job)) console.log(poolLog.slice(-800));
	if (!(login && login.result && login.result.job)) { cleanup(); process.exit(1); }
	const job = login.result.job;
	await setKey(job.seed_hash);
	const height0 = await rpc('getblockcount');

	// regtest difficulty is minimal: the first nonces are blocks
	const target = Buffer.from(job.target, 'hex').readBigUInt64LE(0);
	const start = Buffer.from(job.blob.substr(152, 8), 'hex').readUInt32LE(0);
	let submitted = null;
	for (let k = 0; k < 400 && !submitted; k++) {
		const nb = Buffer.alloc(4); nb.writeUInt32LE((start + k) >>> 0);
		const h = await hashBlob(job.blob.slice(0, 152) + nb.toString('hex') + job.blob.slice(160));
		if (Buffer.from(h.cm, 'hex').readBigUInt64LE(24) < target) {
			const reply = await c.call('submit', {id: login.result.id, job_id: job.job_id, nonce: nb.toString('hex'), result: h.cm});
			submitted = {reply, nonce: nb.toString('hex')};
		}
	}
	check('a share was found and accepted by the pool', !!submitted && !!submitted.reply.result && submitted.reply.result.status === 'OK', JSON.stringify(submitted && submitted.reply));
	await sleep(2500);
	const height1 = await rpc('getblockcount');
	check('the REAL node accepted the block built by the pool', height1 === height0 + 1, 'height ' + height0 + ' -> ' + height1);
	const hash = await rpc('getblockhash', [height1]);
	const block = await rpc('getblock', [hash, 2]);
	check('the coinbase pays the pool address the whole reward and carries the witness commitment', block.tx[0].vout.length === 2 && block.tx[0].vout[0].scriptPubKey.address === poolAddress && block.tx[0].vout[1].scriptPubKey.hex.startsWith('6a24aa21a9ed'), block.tx[0].vout[0].scriptPubKey.address);
	check('the node reports the RandomX fields of the block', typeof block.rx_hash === 'string' && block.rx_hash.length === 64 && typeof block.rx_cm === 'string', block.rx_hash && block.rx_hash.slice(0, 16));
	check('the pool log shows BLOCK FOUND with the node\'s hash', poolLog.indexOf('BLOCK FOUND at height ' + height1) !== -1 && poolLog.indexOf(hash) !== -1);
	const cand = await new Promise(res => R.zrange('Scash:blocks:candidates', 0, -1, 'WITHSCORES', (e, v) => res(v)));
	check('the block candidate is stored with the block hash', cand.length >= 2 && cand[0].split(':')[2] === hash, cand[0] && cand[0].split(':')[2]);
	// the wallet sees the coinbase (immature): what the unlocker will read
	const tx = await rpc('gettransaction', [block.tx[0].txid], 'pool');
	const credit = (tx.details || []).reduce((s, d) => s + (['generate', 'immature'].indexOf(d.category) !== -1 ? d.amount : 0), 0);
	check('the pool wallet sees the immature coinbase', credit > 0, 'credit ' + credit);

	// payouts as the payment processor sends them: the coinbase matures after 100 blocks, then sendmany with subtractfeefrom, as in lib/paymentProcessor.js
	await rpc('generatetoaddress', [100, minerAddress]);
	const spendable = await rpc('getbalance', ['*', 1], 'pool');
	check('the matured coinbase is spendable (getbalance "*" 1)', spendable >= 49, 'balance ' + spendable);
	const payee = (await rpc('getnewaddress', ['', 'bech32'], 'pool'));
	const sent = await rpc('sendmany', ['', {[payee]: 1.5}, 1, 'scash-pool batch 1', [payee]], 'pool');
	check('sendmany with subtractfeefrom returns a txid', typeof sent === 'string' && sent.length === 64, String(sent).slice(0, 20));
	await rpc('generatetoaddress', [1, minerAddress]);
	const ptx = await rpc('gettransaction', [sent], 'pool');
	check('the payout is confirmed and carries the batch comment', ptx.confirmations >= 1 && ptx.comment === 'scash-pool batch 1', 'confirmations ' + ptx.confirmations + ' comment ' + ptx.comment);
	const lt = await rpc('listtransactions', ['*', 20], 'pool');
	check('the payout is found in the wallet log by its comment', lt.some(t => t.txid === sent && t.comment === 'scash-pool batch 1'));

	if (process.env.MINER_BIN) {
		// the real miner: any build of poolpayminer with the algorithm rx/scash
		const before = await rpc('getblockcount');
		const miner = spawn(process.env.MINER_BIN, ['-o', '127.0.0.1:' + conf.poolServer.ports[0].port, '-u', minerAddress + '+realminer', '-p', 'x', '-a', 'rx/scash', '-t', '2', '--no-color', '--randomx-no-numa', '--donate-level', '0'], {stdio: ['ignore', 'pipe', 'pipe']}); procs.push(miner);
		let minerLog = ''; miner.stdout.on('data', d => minerLog += d); miner.stderr.on('data', d => minerLog += d);
		let after = before;
		for (let i = 0; i < 120 && after < before + 2; i++) { await sleep(1000); try { after = await rpc('getblockcount'); } catch (e) {} }   // the node may answer "Work queue depth exceeded" while blocks come in fast
		check('the real miner (' + path.basename(process.env.MINER_BIN) + ' -a rx/scash) found blocks that the REAL node accepted', after >= before + 2, 'height ' + before + ' -> ' + after);
		check('the real miner reports accepted shares', /accepted/.test(minerLog), (minerLog.match(/accepted[^\n]*/) || [''])[0].replace(/\x1b\[[0-9;]*m/g, ''));
		miner.kill();
	}
	cleanup();
	try { await rpc('stop'); } catch (e) {}
	console.log(failed ? '\n' + failed + ' CHECK(S) FAILED\n' + poolLog.slice(-1500) : '\nALL CHECKS PASSED');
	process.exit(failed ? 1 : 0);
})().catch(e => { console.error('test crashed:', e); cleanup(); process.exit(2); });
