// Valid Scash addresses (bech32, hrp "scash", witness version 0, 20 byte program) for the tests: makeAddress(n) is stable per n.
const crypto = require('crypto');
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod (values) {
	let chk = 1;
	for (const v of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
	}
	return chk >>> 0;
}
exports.makeAddress = function (n, hrp) {
	hrp = hrp || 'scash';
	const program = crypto.createHash('sha256').update('scash-test-address-' + n).digest().slice(0, 20);
	let data = [0], acc = 0, bits = 0;
	for (const b of program) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; data.push((acc >> bits) & 31); acc &= (1 << bits) - 1; } }
	if (bits) data.push((acc << (5 - bits)) & 31);
	const exp = []; for (const c of hrp) exp.push(c.charCodeAt(0) >>> 5); exp.push(0); for (const c of hrp) exp.push(c.charCodeAt(0) & 31);
	const mod = polymod(exp.concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
	for (let i = 0; i < 6; i++) data.push((mod >>> (5 * (5 - i))) & 31);
	return hrp + '1' + data.map(d => CHARSET[d]).join('');
};
