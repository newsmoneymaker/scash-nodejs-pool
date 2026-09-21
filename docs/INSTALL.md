# Installing a Satoshi Cash pool

Paths below are examples: the pool in `/opt/scash-nodejs-pool`, the node and its data in `/opt/scash`, all run by the user `scashpool`
(the systemd templates in `deployment/systemd/` use these paths).

## 1. Scash node and wallet

Scash is Bitcoin Core 27 with RandomX. The project's repository is archived but online: `https://github.com/scashnetwork/scash` (branch `scash_master`, tag `scash_v2.0.0-narnia-core-27.0.0`).
Build from source (the authors advise it; the release binaries need Ubuntu 22.04's glibc). **Bitcoin Core 27 needs GCC 10.1 or newer (or Clang 14)**: on an older system (Debian 10 has GCC 8) build in a
newer userland, for example a Debian 11 chroot made with `debootstrap bullseye`, and run the node in it (`RootDirectory=` in the unit; its RPC port is reachable from the host as usual).

```
git clone --depth 1 --branch scash_master https://github.com/scashnetwork/scash && cd scash
# build dependencies: build-essential libtool autotools-dev automake pkg-config bsdmainutils curl git cmake bison python3
./autogen.sh
make -C depends NO_QT=1 -j4                 # downloads and builds boost, libevent, sqlite, RandomX ... (about 30 minutes)
./configure --without-gui --disable-tests --disable-bench --prefix=$PWD/depends/x86_64-pc-linux-gnu --program-transform-name='s/bitcoin/scash/g'
make -j4 && make install                    # scashd, scash-cli, scash-wallet in depends/x86_64-pc-linux-gnu/bin
```

`/opt/scash/data/scash.conf`:

```
chain=scash
server=1
listen=1
rpcuser=scashpool
rpcpassword=<a long random password>
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=8342
dbcache=2048
fallbackfee=0.0001
[scash]
adddnsseed=seed.scash.one
addnode=<ip:8343 of a few nodes>
```

The code has **no built-in seeds**: give the node peers with `addnode` (the peer list of the explorer <https://scash.tv/ext/getnetworkpeers> shows nodes that run `Scash:27.0.0`) and the community DNS seed.
There is no chain snapshot: the synchronisation from the genesis block validates a RandomX hash per block and takes hours. `scash-cli getblockchaininfo` shows the progress.

Create the pool wallet and its address (Core 27 has no default wallet):

```
scash-cli createwallet pool
scash-cli -rpcwallet=pool getnewaddress "" bech32          # scash1q... : the pool address (poolServer.poolAddress)
scash-cli -rpcwallet=pool listdescriptors true > wallet-descriptors.json   # THE recovery data: keep it offline, chmod 600
```

Keep exactly one wallet loaded (the pool talks to the node's root RPC path). `fallbackfee=0.0001` is needed: a node without fee estimates refuses `sendmany` otherwise.

## 2. RandomX helper

The helper must use the same RandomX as the node: the one its depends system built (`depends/x86_64-pc-linux-gnu/lib/librandomx.a`, `include/randomx.h`).

```
cd /opt/scash-nodejs-pool/hasher && make RANDOMX=/opt/scash/src/depends/x86_64-pc-linux-gnu
# built in a newer userland than the host's? make a static binary there: make RANDOMX=... STATIC=-static
```

The helper needs about 2.3 GB of RAM (RandomX dataset, fast mode; `"hasher": {"light": true}` uses 256 MB and is much slower). Check it against the chain: `node test/test-real-blocks.js`.

## 3. Redis

Use a dedicated instance with a password and AOF (`deployment/redis-pool.conf.example`, unit `scash-pool-redis`, port 6384).

## 4. The pool

```
cd /opt/scash-nodejs-pool && npm install --production
cp config_examples/scash.json config.json      # then edit it
```

Edit `config.json`: `poolHost`, `poolServer.poolAddress`, the ports and the certificate for TLS (`poolServer.sslCert/sslKey`), `redis`, `api.password`, `node.password` or `node.passwordFile`,
`blockUnlocker.poolFee` and `donations`, `payments`. **Keep `payments.dryRun: true` until the rehearsal below.**

```
cp deployment/systemd/*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now scash-pool-redis scash-node
systemctl enable --now scash-pool scash-pool-api scash-pool-unlocker scash-pool-payments scash-pool-charts
```

The pool runs as separate modules (`init.js -module=pool|api|unlocker|payments|chartsDataCollector`), each in its own unit. The pool module keeps one hasher process (and its RandomX dataset), so run it as one
process. The RandomX key changes every 7 days (an epoch of Scash): the pool re-initialises the helper by itself (jobs pause for about 10 seconds). Until payouts are proven, restrict the stratum ports with `poolServer.allowIPs`.

## 5. Website

Copy `website_example/` to the web root, set `poolHost`, the contact and links in `config.js`, and proxy `/api` to the pool API on 127.0.0.1:8122 (`deployment/apache-vhost.conf.example` exposes only the read-only methods).

## 6. Rehearse the payments

1. `payments.dryRun: true`: the log of `scash-pool-payments` shows what would be paid.
2. Fund the pool wallet with a few coins (or wait for the first block), credit a small balance in Redis to your own test addresses (`<coin>:workers:<address>`, field `balance`), set `payments.onlyAccounts` to them,
   `dryRun: false`, and watch the payout confirm.
3. Remove the test accounts from Redis and set `onlyAccounts` to `[]`.

Good to know: block rewards can be spent after 100 blocks; `deployment/pause-payments.sh` stops new payouts at once; the wallet must stay unlocked and online for the payouts (leave the pool wallet unencrypted
with only small balances in it).
