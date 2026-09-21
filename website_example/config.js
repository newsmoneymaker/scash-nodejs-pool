/* Scash pool website settings */

// Coin name shown next to the pool name (must equal the "symbol" of the pool config)
var parentCoin = "SCASH";

// Pool API: proxied by the web server from /api to the pool's API on 127.0.0.1
var api = "/api";

// Pool host name shown on the "Getting started" page
var poolHost = "scash.pool-pay.com";

// A notice shown above every page (empty = none)
var poolNotice = {en: "", ru: ""};

// Contact / community links (leave empty to hide)
var email = "admin@pool-pay.com";
var telegram = "";
var discord = "";
var github = "https://github.com/newsmoneymaker/scash-nodejs-pool";
var minerDownload = "/downloads/";      // poolpayminer (optional menu item; leave empty to hide)

// No exchange data source for Scash here, market widgets are hidden
var marketCurrencies = [];

// Block explorer links ({id} = block hash or height / transaction id)
var blockchainExplorer = "https://scash.tv/block/{id}";
// the explorer opens a block by its hash or its height; "height" is the default
var blockExplorerId = "hash";
var transactionExplorer = "https://scash.tv/tx/{id}";

// Theme and default language ("en" or "ru")
var themeCss = "themes/default.css";
var defaultLang = "en";
