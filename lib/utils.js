/**
 * Scash Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 * https://github.com/dvandal/cryptonote-nodejs-pool
 *
 * Utilities functions
 **/

// Load required module
let crypto = require('crypto');

let dateFormat = require('dateformat');
exports.dateFormat = dateFormat;

/**
 * Generate random instance id
 **/
exports.instanceId = function () {
	return crypto.randomBytes(4);
}

/**
 * Scash addresses. A miner is identified by a native SegWit address: bech32 with the prefix "scash"
 * ("scash1q..." = witness version 0, 20 byte program, 45 characters). Payouts are sent to it, and its script is what
 * the coinbase of a block pays to when the address is the pool's.
 * Stealth ("sv1...") and other address types are not accepted for mining logins.
 **/
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const SCASH_HRP = (typeof config !== 'undefined' && config && config.addressPrefix) || 'scash';   // 'tscash' on the test network, 'rscash' on regtest

function bech32Polymod (values) {
	let chk = 1;
	for (let v of values) {
		let top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i];
	}
	return chk >>> 0;
}

function bech32HrpExpand (hrp) {
	let out = [];
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
	out.push(0);
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
	return out;
}

/**
 * Validate a native SegWit address. Returns {address, hrp, version, program} or null.
 **/
function parseMinerAddress (address) {
	if (typeof address !== 'string' || address.length !== SCASH_HRP.length + 1 + 39) return null;
	if (address !== address.toLowerCase()) return null;
	let sep = address.lastIndexOf('1');
	if (sep !== SCASH_HRP.length || address.slice(0, sep) !== SCASH_HRP) return null;
	let data = [];
	for (let ch of address.slice(sep + 1)) {
		let idx = BECH32_CHARSET.indexOf(ch);
		if (idx < 0) return null;
		data.push(idx);
	}
	if (bech32Polymod(bech32HrpExpand(SCASH_HRP).concat(data)) !== 1) return null;
	if (data[0] !== 0) return null; // witness version 0 only
	// 5 bit groups -> the 20 byte witness program (data without the version and the 6 checksum groups)
	let bits = 0, acc = 0, bytes = [];
	for (let v of data.slice(1, data.length - 6)) {
		acc = (acc << 5) | v;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((acc >> bits) & 0xff);
			acc &= (1 << bits) - 1;
		}
	}
	if (bytes.length !== 20 || bits >= 5 || acc !== 0) return null;   // P2WPKH only, canonical padding
	return {address: address, hrp: SCASH_HRP, version: data[0], program: Buffer.from(bytes)};
}
exports.parseMinerAddress = parseMinerAddress;

// scriptPubKey (hex) of a valid address: OP_0 <20 byte program>
exports.addressScript = function (address) {
	let parsed = parseMinerAddress(address);
	return parsed ? '0014' + parsed.program.toString('hex') : null;
};

// Validate miner address
exports.validateMinerAddress = function (address) {
	return parseMinerAddress(address) !== null;
}

// Canonical form of a valid address, or null
exports.canonicalMinerAddress = function (address) {
	let parsed = parseMinerAddress(address);
	return parsed ? parsed.address : null;
}

/**
 * Miner account. Kept for the code shared with the other pools of this family (Scash has no deposit notes):
 * account = address, note = null.
 **/
function parseMinerAccount (input) {
	let parsed = parseMinerAddress(input);
	if (!parsed) return null;
	return {publicKey: parsed.address, domain: null, address: parsed.address, note: null, account: parsed.address};
}
exports.parseMinerAccount = parseMinerAccount;

exports.canonicalMinerAccount = function (input) {
	let parsed = parseMinerAccount(input);
	return parsed ? parsed.account : null;
}

// Split a stored account back into {address, note}
exports.splitMinerAccount = function (account) {
	return {address: account, note: null};
}

/**
 * Developer donation table of the config: blockUnlocker.donations = {"<Scash address>": percent of the block reward}.
 * Returns {canonical account: percent} of the valid entries (percent above 0 up to 10); onInvalid(address) is called for the others.
 **/
exports.donationTable = function (unlockerConfig, onInvalid) {
	let table = {};
	let entries = (unlockerConfig && unlockerConfig.donations) || {};
	Object.keys(entries).forEach(function (address) {
		let account = exports.canonicalMinerAccount(address);
		let percent = parseFloat(entries[address]);
		if (!account || !(percent > 0) || percent > 10) {
			if (onInvalid) onInvalid(address);
			return;
		}
		table[account] = percent;
	});
	return table;
};

function characterCount (string, char) {
	let re = new RegExp(char, "gi")
	let matches = string.match(re)
	return matches === null ? 0 : matches.length;
}
exports.characterCount = characterCount;

exports.determineRewardData = (value) => {
	let calculatedData = {
		'address': value,
		'rewardType': 'prop'
	}
	if (/^solo:/i.test(value)) {
		calculatedData['address'] = value.substr(5)
		calculatedData['rewardType'] = 'solo'
		return calculatedData
	}
	if (/^prop:/i.test(value)) {
		calculatedData['address'] = value.substr(5)
		calculatedData['rewardType'] = 'prop'
		return calculatedData
	}
	return calculatedData
}

/**
 * Cleanup special characters (fix for non latin characters)
 **/
function cleanupSpecialChars (str) {
	str = str.replace(/[ÀÁÂÃÄÅ]/g, "A");
	str = str.replace(/[àáâãäå]/g, "a");
	str = str.replace(/[ÈÉÊË]/g, "E");
	str = str.replace(/[èéêë]/g, "e");
	str = str.replace(/[ÌÎÏ]/g, "I");
	str = str.replace(/[ìîï]/g, "i");
	str = str.replace(/[ÒÔÖ]/g, "O");
	str = str.replace(/[òôö]/g, "o");
	str = str.replace(/[ÙÛÜ]/g, "U");
	str = str.replace(/[ùûü]/g, "u");
	return str.replace(/[^A-Za-z0-9\-\_+]/gi, '');
}
exports.cleanupSpecialChars = cleanupSpecialChars;

/**
 * Get readable hashrate
 **/
exports.getReadableHashRate = function (hashrate) {
	let i = 0;
	let byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH'];
	while (hashrate > 1000) {
		hashrate = hashrate / 1000;
		i++;
	}
	return hashrate.toFixed(2) + byteUnits[i] + '/sec';
}

/**
 * Get readable coins
 **/
exports.getReadableCoins = function (coins, digits, withoutSymbol) {
	let coinDecimalPlaces = config.coinDecimalPlaces || config.coinUnits.toString().length - 1;
	let amount = (parseInt(coins || 0) / config.coinUnits).toFixed(digits || coinDecimalPlaces);
	return amount + (withoutSymbol ? '' : (' ' + config.symbol));
}

/**
 * Generate unique id
 **/
exports.uid = function () {
	let min = 100000000000000;
	let max = 999999999999999;
	let id = Math.floor(Math.random() * (max - min + 1)) + min;
	return id.toString();
};

/**
 * Ring buffer
 **/
exports.ringBuffer = function (maxSize) {
	let data = [];
	let cursor = 0;
	let isFull = false;

	return {
		append: function (x) {
			if (isFull) {
				data[cursor] = x;
				cursor = (cursor + 1) % maxSize;
			} else {
				data.push(x);
				cursor++;
				if (data.length === maxSize) {
					cursor = 0;
					isFull = true;
				}
			}
		},
		avg: function (plusOne) {
			let sum = data.reduce(function (a, b) {
				return a + b
			}, plusOne || 0);
			return sum / ((isFull ? maxSize : cursor) + (plusOne ? 1 : 0));
		},
		size: function () {
			return isFull ? maxSize : cursor;
		},
		clear: function () {
			data = [];
			cursor = 0;
			isFull = false;
		}
	};
};
