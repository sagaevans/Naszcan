
      (function () {
        "use strict";
        var DS = "https://api.dexscreener.com/tokens/v1/solana/";
        var RPC = "https://solana-rpc.publicnode.com";
        var SOL_MINT = "So11111111111111111111111111111111111111112";
        var SLING = "umXBYVG9NZsij5gWyVYRBEbVxJucEfX4B69RNZ2pump";
        var WL_DEFAULT = [
          { ca: SLING, symbol: "sling" },
          { ca: "9uNgkUWsRDCMsnE6UX9aJ9bCwj3Lw3pjTU4TnMEnpump", symbol: "BILLIONS" },
          { ca: "4iwYFoGp4rDdyG7FnxYwsB1tkUqnzJFHPeQUb2M1pump", symbol: "SHARD" }
        ];
        var $ = function (id) { return document.getElementById(id); };

        function blankState(start) {
          return { version: 1, initialCash: start, cash: start, positions: {}, history: [],
            watchlist: WL_DEFAULT.map(function (w) { return { ca: w.ca, symbol: w.symbol }; }),
            settings: { fee: 1, slip: 1 } };
        }
        function seedState() {
          var s = blankState(100);
          s.cash = 95;
          s.positions[SLING] = { ca: SLING, symbol: "sling", name: "sling", tokens: 382500, cost: 5, lastPrice: 0.00001294 };
          s.history = [{ ts: Date.parse("2026-10-25T13:00:00+07:00"), side: "beli", ca: SLING, symbol: "sling", usd: 5, tokens: 382500, price: 0.00001294, fee: 0.05 }];
          return s;
        }

        var S = blankState(100);
        var info = {};            // ca -> live token data
        var active = null;        // active CA
        var solPrice = null;
        var lastUpdate = 0;
        var autoOn = true;
        var interval = 15000;
        var timer = null;
        var busy = false;
        var errMsg = "";
        var tab = "beli";
        var sellPct = 100;
        var chartPair = null;

        /* ---------- formatting ---------- */
        function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
        function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : NaN; }
        function fmtPrice(p) {
          if (p == null || !isFinite(p)) return "—";
          if (p === 0) return "$0";
          if (p >= 1) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
          var d = Math.min(18, Math.max(4, -Math.floor(Math.log10(p)) + 3));
          return "$" + p.toFixed(d).replace(/(\.\d*?[1-9])0+$/, "$1");
        }
        function fmtUsd(n, sign) {
          if (n == null || !isFinite(n)) return "—";
          var a = Math.abs(n), s = n < 0 ? "−" : sign && n > 0 ? "+" : "";
          var d = a > 0 && a < 0.01 ? 4 : 2;
          return s + "$" + a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
        }
        var compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
        function fmtBig(n) { return n == null || !isFinite(n) ? "—" : "$" + compact.format(n); }
        function fmtTok(n) {
          if (n == null || !isFinite(n)) return "—";
          return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 6 });
        }
        function fmtPct(n) { if (n == null || !isFinite(n)) return "—"; return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%"; }
        function cls(n) { return n > 0 ? "x-up" : n < 0 ? "x-down" : ""; }
        function short(ca) { return ca.slice(0, 4) + "…" + ca.slice(-4); }
        var wib = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        function fmtTime(ts) { try { return wib.format(new Date(ts)) + " WIB"; } catch (e) { return new Date(ts).toISOString(); } }

        var toastT;
        function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("is-on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("is-on"); }, 2200); }

        function copyText(text, selectEl) {
          function fallback() {
            var ok = false;
            try {
              var ta = selectEl;
              if (!ta) { ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); }
              ta.focus(); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) {}
              ok = document.execCommand("copy");
              if (!selectEl) document.body.removeChild(ta);
            } catch (e) { ok = false; }
            toast(ok ? "Disalin" : selectEl ? "Teks sudah dipilih, tekan lama lalu Salin" : "Gagal menyalin: " + text);
          }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () { toast("Disalin"); if (selectEl) { selectEl.focus(); selectEl.select(); } }, fallback);
              return;
            }
          } catch (e) {}
          fallback();
        }

        /* ---------- data ---------- */
        function fetchJSON(url, opts) {
          var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
          var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
          opts = opts || {};
          if (ctrl) opts.signal = ctrl.signal;
          return fetch(url, opts).then(function (r) {
            clearTimeout(to);
            if (r.status === 429) { var e = new Error("429"); e.rate = true; throw e; }
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          }, function (e) { clearTimeout(to); throw new Error(e && e.name === "AbortError" ? "waktu habis" : "jaringan"); });
        }
        function liq(p) { return (p && p.liquidity && +p.liquidity.usd) || 0; }
        function pickPair(pairs) {
          if (!pairs || !pairs.length) return null;
          var best = null;
          pairs.forEach(function (p) { if (liq(p) > 0 && (!best || liq(p) > liq(best))) best = p; });
          return best || pairs[0];
        }
        function parsePair(p) {
          var price = p.priceUsd != null && p.priceUsd !== "" ? +p.priceUsd : null;
          return {
            name: p.baseToken && p.baseToken.name, symbol: p.baseToken && p.baseToken.symbol, dexId: p.dexId,
            dexPrice: price, price: price, src: price != null ? "dex" : null,
            marketCap: p.marketCap != null ? +p.marketCap : null, fdv: p.fdv != null ? +p.fdv : null, mcEst: false,
            liq: p.liquidity ? p.liquidity.usd : null,
            vol1h: p.volume ? p.volume.h1 : null, vol24: p.volume ? p.volume.h24 : null,
            ch5m: p.priceChange ? p.priceChange.m5 : null, ch1h: p.priceChange ? p.priceChange.h1 : null, ch24: p.priceChange ? p.priceChange.h24 : null,
            buys: p.txns && p.txns.h1 ? p.txns.h1.buys : null, sells: p.txns && p.txns.h1 ? p.txns.h1.sells : null,
            pairAddress: p.pairAddress, url: p.url, imageUrl: p.info && p.info.imageUrl
          };
        }
        function getSolPrice() {
          return fetchJSON(DS + SOL_MINT).then(function (pairs) {
            pairs = (pairs || []).filter(function (p) { return p.baseToken && p.baseToken.address === SOL_MINT && p.priceUsd; });
            var stable = pairs.filter(function (p) { var q = p.quoteToken && p.quoteToken.symbol; return q === "USDC" || q === "USDT"; });
            var best = pickPair(stable.length ? stable : pairs);
            return best ? +best.priceUsd : null;
          });
        }
        function fetchBatch(cas) {
          var chunks = [];
          for (var i = 0; i < cas.length; i += 30) chunks.push(cas.slice(i, i + 30));
          return Promise.all(chunks.map(function (c) { return fetchJSON(DS + c.join(",")); })).then(function (res) {
            var out = {};
            cas.forEach(function (ca) {
              var mine = [];
              res.forEach(function (arr) { (arr || []).forEach(function (p) { if (p.baseToken && p.baseToken.address === ca) mine.push(p); }); });
              var best = pickPair(mine);
              out[ca] = best ? parsePair(best) : null;
            });
            return out;
          });
        }
        function rpc(method, params) {
          return fetchJSON(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }) })
            .then(function (j) { if (j.error) throw new Error("RPC: " + (j.error.message || "error")); return j.result; });
        }
        function uiAmt(b) { var u = b.uiTokenAmount || {}; return u.uiAmount != null ? +u.uiAmount : +(u.uiAmountString || 0); }
        function rpcPrice(ca) {
          return rpc("getSignaturesForAddress", [ca, { limit: 6 }]).then(function (sigs) {
            sigs = (sigs || []).filter(function (s) { return !s.err; });
            var i = 0;
            function next() {
              if (i >= sigs.length) return null;
              var sig = sigs[i++].signature;
              return rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).then(function (tx) {
                if (!tx || !tx.meta || tx.meta.err) return next();
                var keys = tx.transaction.message.accountKeys || [];
                var signer = keys[0] && (keys[0].pubkey || keys[0]);
                var sum = function (arr) { return (arr || []).reduce(function (a, b) { return b.owner === signer && b.mint === ca ? a + uiAmt(b) : a; }, 0); };
                var dTok = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
                var dSol = (tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee) / 1e9;
                if (dTok !== 0 && dSol !== 0 && isFinite(dTok) && isFinite(dSol)) return { priceSol: Math.abs(dSol) / Math.abs(dTok), time: tx.blockTime };
                return next();
              }, function (e) { if (e.rate) throw e; return next(); });
            }
            return next();
          });
        }

        function priceOf(ca) {
          var d = info[ca];
          if (d && d.price != null) return d.price;
          var p = S.positions[ca];
          return p && p.lastPrice != null ? p.lastPrice : null;
        }

        function refresh() {
          if (busy) return;
          busy = true;
          clearTimeout(timer);
          renderStatus();
          var cas = Object.keys(S.positions);
          if (active && cas.indexOf(active) < 0) cas.unshift(active);
          var solP = getSolPrice().catch(function (e) { if (e.rate) throw e; return null; });
          var batch = cas.length ? fetchBatch(cas) : Promise.resolve({});
          Promise.all([solP, batch]).then(function (r) {
            if (r[0]) solPrice = r[0];
            var map = r[1];
            Object.keys(map).forEach(function (ca) {
              var prev = info[ca];
              if (map[ca]) {
                info[ca] = map[ca];
                if (map[ca].price == null && prev && prev.src === "rpc") { info[ca].price = prev.price; info[ca].src = "rpc"; info[ca].rpcTime = prev.rpcTime; }
              } else if (!prev) {
                info[ca] = { name: null, symbol: null, dexId: null, price: null, src: null, notFound: true };
              }
            });
            if (active && info[active] && info[active].dexPrice == null) {
              if (!solPrice) throw new Error("harga SOL belum tersedia");
              return rpcPrice(active).then(function (res) {
                var d = info[active];
                if (res) {
                  d.price = res.priceSol * solPrice; d.src = "rpc"; d.rpcTime = res.time;
                  d.marketCap = d.price * 1e9; d.mcEst = true;
                } else if (d.price == null) {
                  throw new Error("belum ada transaksi on-chain yang bisa dihitung");
                }
              });
            }
          }).then(function () {
            Object.keys(S.positions).forEach(function (ca) {
              var d = info[ca], p = S.positions[ca];
              if (d && d.price != null) { p.lastPrice = d.price; if (d.symbol) p.symbol = d.symbol; if (d.name) p.name = d.name; }
            });
            lastUpdate = Date.now(); interval = 15000; errMsg = "";
          }).catch(function (e) {
            if (e && e.rate) { interval = 30000; errMsg = "Terlalu banyak permintaan (429). Dicoba lagi otomatis dalam 30 detik."; }
            else { errMsg = "Gagal memuat data (" + ((e && e.message) || "error") + "). Coba lagi."; }
          }).then(function () {
            busy = false;
            renderAll();
            schedule();
          });
        }
        function schedule() {
          clearTimeout(timer);
          if (autoOn || (errMsg && interval === 30000)) timer = setTimeout(refresh, interval);
        }

        function validCA(s) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }
        function loadToken(ca) {
          ca = (ca || "").trim();
          if (!validCA(ca)) { toast("CA tidak valid"); return; }
          if (active !== ca) { active = ca; errMsg = ""; }
          $("ca-input").value = ca;
          renderAll();
          busy = false;
          refresh();
        }

        /* ---------- trading ---------- */
        function feeRate() { return Math.min(5, Math.max(0, S.settings.fee)) / 100; }
        function slipRate() { return Math.min(50, Math.max(0, S.settings.slip)) / 100; }
        function symOf(ca) { var d = info[ca], p = S.positions[ca]; return (d && d.symbol) || (p && p.symbol) || short(ca); }

        function buy() {
          var U = num($("buy-amt").value), price = priceOf(active);
          if (!(U > 0) || !price || U > S.cash + 1e-9) return;
          var fee = U * feeRate(), exec = price * (1 + slipRate()), toks = (U - fee) / exec;
          var d = info[active] || {};
          var p = S.positions[active] || (S.positions[active] = { ca: active, symbol: symOf(active), name: d.name || symOf(active), tokens: 0, cost: 0, lastPrice: price });
          p.tokens += toks; p.cost += U; p.lastPrice = price;
          S.cash = Math.max(0, S.cash - U);
          S.history.unshift({ ts: Date.now(), side: "beli", ca: active, symbol: symOf(active), usd: U, tokens: toks, price: exec, fee: fee });
          toast("Beli " + fmtTok(toks) + " " + symOf(active));
          renderAll();
        }
        function sell() {
          var p = S.positions[active], price = priceOf(active);
          if (!p || !price) return;
          var f = sellPct / 100, toks = p.tokens * f, exec = price * (1 - slipRate());
          var gross = toks * exec, fee = gross * feeRate(), net = gross - fee;
          S.cash += net;
          S.history.unshift({ ts: Date.now(), side: "jual", ca: active, symbol: symOf(active), usd: net, tokens: toks, price: exec, fee: fee });
          if (f >= 1 || p.tokens - toks < 1e-9) delete S.positions[active];
          else { p.cost *= (1 - f); p.tokens -= toks; }
          toast("Jual " + sellPct + "% " + symOf(active) + " → " + fmtUsd(net));
          renderAll();
        }

        /* ---------- render ---------- */
        function totals() {
          var val = 0;
          Object.keys(S.positions).forEach(function (ca) { var p = S.positions[ca], pr = priceOf(ca); val += pr != null ? p.tokens * pr : p.cost; });
          return { pos: val, total: S.cash + val };
        }
        function renderHeader() {
          var t = totals(), pl = t.total - S.initialCash, pct = S.initialCash ? pl / S.initialCash * 100 : 0;
          $("h-cash").textContent = fmtUsd(S.cash);
          $("h-total").textContent = fmtUsd(t.total);
          var el = $("h-pl"); el.textContent = fmtUsd(pl, true); el.className = "stat__fig " + cls(pl);
          $("h-pl-label").textContent = "Total P/L (" + fmtPct(pct) + ")";
          $("h-start").textContent = "Saldo awal " + fmtUsd(S.initialCash);
        }
        function ago() {
          if (!lastUpdate) return busy ? "Memuat…" : "Belum diperbarui";
          var s = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
          return (busy ? "Memuat… · " : "") + "Diperbarui " + s + " detik lalu";
        }
        function renderStatus() {
          var el = $("st-ago"); if (el) el.textContent = ago();
          var r = $("st-refresh"); if (r) r.disabled = busy;
        }
        function badge(d) {
          if (!d || !d.dexId) return active && /pump$/.test(active) ? '<span class="chip">Belum ada pair (kemungkinan bonding curve pump.fun)</span>' : '<span class="chip">Pair tidak ditemukan</span>';
          if (d.dexId === "pumpfun") return '<span class="chip">Bonding curve pump.fun</span>';
          return '<span class="chip chip--solid">Sudah graduate (' + esc(d.dexId) + ")</span>";
        }
        function chg(v) { return '<dd class="' + cls(+v) + '">' + fmtPct(v == null ? null : +v) + "</dd>"; }
        function renderToken() {
          var el = $("token-card");
          if (!active) {
            el.innerHTML = '<h3>Belum ada token</h3><p class="x-src">Tempel CA di atas atau ketuk token di watchlist.</p>';
            return;
          }
          var d = info[active] || {}, price = priceOf(active), sym = symOf(active);
          var logo = d.imageUrl ? '<img class="x-logo" src="' + esc(d.imageUrl) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' : '<span class="x-logo" aria-hidden="true">' + esc(sym.slice(0, 2).toUpperCase()) + "</span>";
          var inWl = S.watchlist.some(function (w) { return w.ca === active; });
          var src = d.src === "rpc" ? "Harga dari transaksi on-chain terakhir (perkiraan)" + (solPrice ? " · SOL " + fmtPrice(solPrice) : "")
            : d.src === "dex" ? "Harga DexScreener" : (price != null ? "Harga terakhir yang diketahui" : (busy ? "Memuat harga…" : "Harga belum tersedia"));
          var mc = d.marketCap != null ? d.marketCap : d.fdv;
          var html = '<div class="x-tok">' + logo + "<div><h3>" + esc(d.name || sym) + "<small>$" + esc(sym) + "</small></h3>" +
            '<button class="x-ca" type="button" data-copy="' + esc(active) + '" aria-label="Salin CA">' + esc(short(active)) + " · salin</button></div></div>" +
            '<p class="x-row">' + badge(d) + "</p>" +
            '<div><p class="x-price">' + fmtPrice(price) + '</p><p class="x-src">' + esc(src) + "</p></div>" +
            '<dl class="x-metrics">' +
            "<div><dt>Market cap" + (d.mcEst ? " (perkiraan)" : "") + "</dt><dd>" + fmtBig(mc) + "</dd></div>" +
            "<div><dt>Likuiditas</dt><dd>" + fmtBig(d.liq) + "</dd></div>" +
            "<div><dt>Volume 1j / 24j</dt><dd>" + fmtBig(d.vol1h) + " / " + fmtBig(d.vol24) + "</dd></div>" +
            "<div><dt>Perubahan 5m</dt>" + chg(d.ch5m) + "</div>" +
            "<div><dt>Perubahan 1j</dt>" + chg(d.ch1h) + "</div>" +
            "<div><dt>Perubahan 24j</dt>" + chg(d.ch24) + "</div>" +
            "<div><dt>Beli vs jual (1j)</dt><dd><span class=\"x-up\">" + (d.buys != null ? d.buys : "—") + "</span> / <span class=\"x-down\">" + (d.sells != null ? d.sells : "—") + "</span></dd></div>" +
            "</dl>" +
            (errMsg ? '<p class="x-err" role="alert">' + esc(errMsg) + "</p>" : "") +
            '<div class="x-status"><span id="st-ago">' + esc(ago()) + "</span></div>" +
            '<div class="x-row">' +
            '<button class="x-b x-b--sm" type="button" id="st-refresh"' + (busy ? " disabled" : "") + ">" + (errMsg ? "Coba lagi" : "Perbarui") + "</button>" +
            '<button class="x-b x-b--sm" type="button" id="st-auto" aria-pressed="' + autoOn + '">Auto ' + (interval / 1000) + " dtk: " + (autoOn ? "aktif" : "mati") + "</button>" +
            (inWl ? "" : '<button class="x-b x-b--sm" type="button" id="wl-add">+ Watchlist</button>') +
            (d.url ? '<a class="btn" href="' + esc(d.url) + '" target="_blank" rel="noopener">Buka di DexScreener</a>' : "") +
            "</div>";
          el.innerHTML = html;
        }
        // Penyimpanan browser tersedia? (Hark Page = iframe sandbox tanpa allow-same-origin -> tidak)
        var CAN_STORE = (function () { try { var k = "__t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; } })();
        // Embed DexScreener hanya jalan di luar sandbox Hark (CSP Hark memblokir iframe luar)
        var USE_EMBED = CAN_STORE;
        var GT = "https://api.geckoterminal.com/api/v2/networks/solana/";
        var TF = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1j": ["hour", 1], "4j": ["hour", 4] };
        var chartTf = "5m", lwChart = null, lwSeries = null, lwVol = null, chartTimer = null, chartLoadedFor = "", gtPoolCache = {};
        function gtPool(ca, pair) {
          if (pair) return Promise.resolve(pair);
          if (gtPoolCache[ca]) return Promise.resolve(gtPoolCache[ca]);
          return fetch(GT + "tokens/" + ca + "/pools?page=1").then(function (r) { return r.json(); }).then(function (j) {
            var p = j && j.data && j.data[0] && j.data[0].attributes && j.data[0].attributes.address;
            if (p) gtPoolCache[ca] = p; return p || null;
          });
        }
        function ensureLw() {
          if (lwChart || !window.LightweightCharts) return !!lwChart;
          var box = $("ohlc");
          var dark = document.documentElement.getAttribute("data-theme") !== "light";
          lwChart = LightweightCharts.createChart(box, {
            autoSize: true,
            layout: { background: { color: "transparent" }, textColor: dark ? "#c8c8c8" : "#333", fontFamily: "Geist, system-ui, sans-serif" },
            grid: { vertLines: { color: "rgba(128,128,128,0.12)" }, horzLines: { color: "rgba(128,128,128,0.12)" } },
            rightPriceScale: { borderVisible: false },
            timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
            localization: { timeFormatter: function (t) { return new Date(t * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }); } }
          });
          lwSeries = lwChart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444", borderVisible: false,
            priceFormat: { type: "custom", minMove: 1e-12, formatter: function (p) { return fmtChartPrice(p); } } });
          lwVol = lwChart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(128,128,128,0.35)" });
          lwChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          return true;
        }
        function fmtChartPrice(p) {
          if (!isFinite(p)) return "";
          if (p >= 1) return "$" + p.toFixed(4);
          var e = Math.floor(Math.log10(Math.abs(p) || 1e-18));
          return "$" + p.toFixed(Math.min(14, Math.max(2, -e + 3)));
        }
        function loadCandles(force) {
          var d = active && info[active]; if (!d) return;
          var ca = active, tf = TF[chartTf], key = ca + "|" + chartTf;
          var msg = $("ohlc-msg");
          gtPool(ca, d.pairAddress).then(function (pool) {
            if (!pool) throw new Error("nopool");
            return fetch(GT + "pools/" + pool + "/ohlcv/" + tf[0] + "?aggregate=" + tf[1] + "&limit=300&currency=usd");
          }).then(function (r) {
            if (r.status === 429) throw new Error("limit");
            return r.json();
          }).then(function (j) {
            if (active !== ca) return;
            var list = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
            var seen = {}, rows = [];
            list.forEach(function (c) { if (!seen[c[0]]) { seen[c[0]] = 1; rows.push(c); } });
            rows.sort(function (a, b) { return a[0] - b[0]; });
            if (!ensureLw()) { msg.textContent = "Library grafik gagal dimuat."; msg.hidden = false; return; }
            lwSeries.setData(rows.map(function (c) { return { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }; }));
            lwVol.setData(rows.map(function (c) { return { time: c[0], value: c[5], color: c[4] >= c[1] ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)" }; }));
            if (key !== chartLoadedFor) { lwChart.timeScale().fitContent(); chartLoadedFor = key; }
            msg.hidden = rows.length > 0;
            if (!rows.length) msg.textContent = "Belum ada data candle untuk koin ini.";
          }).catch(function (e) {
            if (active !== ca) return;
            msg.textContent = e.message === "limit" ? "GeckoTerminal sedang membatasi permintaan, dicoba lagi sebentar." : e.message === "nopool" ? "Pool belum ditemukan di GeckoTerminal." : "Grafik gagal dimuat, dicoba lagi otomatis.";
            msg.hidden = false;
          });
        }
        function renderChart() {
          var d = active && info[active], pair = d && d.pairAddress;
          $("chart-wrap").hidden = !d;
          if (!d) return;
          if (USE_EMBED && pair) {
            $("chart").hidden = false; $("ohlc-box").hidden = true;
            if (pair !== chartPair) { chartPair = pair; $("chart").src = "https://dexscreener.com/solana/" + encodeURIComponent(pair) + "?embed=1&theme=dark&trades=0&info=0"; }
            return;
          }
          $("chart").hidden = true; $("ohlc-box").hidden = false;
          if (chartPair !== active + "|" + chartTf) { chartPair = active + "|" + chartTf; loadCandles(true); }
          if (!chartTimer) chartTimer = setInterval(function () { if (autoOn && !document.hidden) loadCandles(false); }, 30000);
        }
        function renderTrade() {
          var el = $("trade-panel");
          var focusId = document.activeElement && document.activeElement.id;
          var keepBuy = $("buy-amt") ? $("buy-amt").value : "5";
          var price = active ? priceOf(active) : null, pos = active && S.positions[active], sym = active ? symOf(active) : "";
          var html = '<div class="x-seg" role="tablist" aria-label="Beli atau jual">' +
            '<button type="button" role="tab" data-tab="beli" aria-selected="' + (tab === "beli") + '">Beli</button>' +
            '<button type="button" role="tab" data-tab="jual" aria-selected="' + (tab === "jual") + '">Jual</button></div>';
          if (tab === "beli") {
            html += '<label class="x-label" for="buy-amt">Jumlah (USD) · kas ' + fmtUsd(S.cash) +
              '<input class="x-input" id="buy-amt" type="text" inputmode="decimal" autocomplete="off" value="' + esc(keepBuy) + '" /></label>' +
              '<div class="x-quick">' + [1, 5, 10, 25].map(function (v) { return '<button class="x-b" type="button" data-amt="' + v + '">$' + v + "</button>"; }).join("") +
              '<button class="x-b" type="button" data-amt="max">Max</button></div>' +
              '<dl class="x-kv" id="buy-prev"></dl>' +
              '<button class="x-b x-b--main" type="button" id="buy-go">Beli</button>';
          } else {
            html += '<dl class="x-kv"><dt>Dimiliki</dt><dd>' + (pos ? fmtTok(pos.tokens) + " " + esc(sym) : "0") + "</dd>" +
              "<dt>Nilai kini</dt><dd>" + (pos && price ? fmtUsd(pos.tokens * price) : "—") + "</dd></dl>" +
              '<div class="x-quick x-quick--3">' + [25, 50, 100].map(function (v) { return '<button class="x-b" type="button" data-pct="' + v + '" aria-pressed="' + (sellPct === v) + '">' + v + "%</button>"; }).join("") + "</div>" +
              '<dl class="x-kv" id="sell-prev"></dl>' +
              '<button class="x-b x-b--main" type="button" id="sell-go">Jual</button>';
          }
          html += '<div class="x-row">' +
            '<label class="x-label x-grow" style="flex-basis:100px" for="set-fee">Fee per trade (0–5%)<input class="x-input" id="set-fee" type="text" inputmode="decimal" value="' + S.settings.fee + '" /></label>' +
            '<label class="x-label x-grow" style="flex-basis:100px" for="set-slip">Slippage (%)<input class="x-input" id="set-slip" type="text" inputmode="decimal" value="' + S.settings.slip + '" /></label></div>' +
            '<p class="x-src">Slippage merugikan Anda: beli di harga × (1 + slip), jual di harga × (1 − slip).</p>';
          el.innerHTML = html;
          if (focusId && $(focusId) && /^(buy-amt|set-fee|set-slip)$/.test(focusId)) { var f = $(focusId); f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {} }
          updatePreview();
        }
        function updatePreview() {
          var price = active ? priceOf(active) : null, sym = active ? esc(symOf(active)) : "";
          if (tab === "beli" && $("buy-prev")) {
            var U = num($("buy-amt").value), btn = $("buy-go"), reason = "";
            if (!active) reason = "Muat token dulu";
            else if (!price) reason = "Harga belum tersedia";
            else if (!(U > 0)) reason = "Masukkan jumlah";
            else if (U > S.cash + 1e-9) reason = "Saldo kas tidak cukup";
            btn.disabled = !!reason;
            btn.textContent = reason || "Beli " + fmtUsd(U) + " " + symOf(active);
            if (price && U > 0) {
              var fee = U * feeRate(), exec = price * (1 + slipRate());
              $("buy-prev").innerHTML = "<dt>Harga eksekusi</dt><dd>" + fmtPrice(exec) + "</dd><dt>Fee</dt><dd>" + fmtUsd(fee) + "</dd><dt>Dapat ±</dt><dd>" + fmtTok((U - fee) / exec) + " " + sym + "</dd>";
            } else $("buy-prev").innerHTML = "";
          }
          if (tab === "jual" && $("sell-prev")) {
            var pos = active && S.positions[active], b = $("sell-go"), r = "";
            if (!active) r = "Muat token dulu"; else if (!pos) r = "Tidak ada posisi"; else if (!price) r = "Harga belum tersedia";
            b.disabled = !!r;
            b.textContent = r || "Jual " + sellPct + "% " + symOf(active);
            if (!r) {
              var toks = pos.tokens * sellPct / 100, ex = price * (1 - slipRate()), g = toks * ex, fe = g * feeRate(), net = g - fe, pl = net - pos.cost * sellPct / 100;
              $("sell-prev").innerHTML = "<dt>Harga eksekusi</dt><dd>" + fmtPrice(ex) + "</dd><dt>Fee</dt><dd>" + fmtUsd(fe) + "</dd><dt>Terima ±</dt><dd>" + fmtUsd(net) + "</dd><dt>P/L terealisasi</dt><dd class=\"" + cls(pl) + "\">" + fmtUsd(pl, true) + "</dd>";
            } else $("sell-prev").innerHTML = "";
          }
        }
        function renderPositions() {
          var cas = Object.keys(S.positions), body = $("pos-body");
          if (!cas.length) { body.innerHTML = '<tr><td class="x-empty" colspan="7">Belum ada posisi. Beli token di bagian Trading.</td></tr>'; return; }
          body.innerHTML = cas.map(function (ca) {
            var p = S.positions[ca], pr = priceOf(ca), val = pr != null ? p.tokens * pr : null, pl = val != null ? val - p.cost : null, pct = pl != null && p.cost ? pl / p.cost * 100 : null;
            return '<tr' + (ca === active ? ' class="is-highlight"' : "") + '><th scope="row">' + esc(p.symbol || short(ca)) + "<small>" + esc(short(ca)) + "</small></th>" +
              '<td data-label="Jumlah">' + fmtTok(p.tokens) + "</td>" +
              '<td data-label="Harga masuk">' + fmtPrice(p.cost / p.tokens) + "</td>" +
              '<td data-label="Harga kini">' + fmtPrice(pr) + "</td>" +
              '<td class="num" data-label="Nilai">' + fmtUsd(val) + "</td>" +
              '<td class="num ' + cls(pl) + '" data-label="P/L">' + fmtUsd(pl, true) + "<small>" + fmtPct(pct) + "</small></td>" +
              '<td><div class="x-acts"><button class="x-b x-b--sm" type="button" data-sell="' + esc(ca) + '">Jual</button><button class="x-b x-b--sm" type="button" data-view="' + esc(ca) + '">Lihat</button></div></td></tr>';
          }).join("");
        }
        function renderHistory() {
          var body = $("hist-body");
          if (!S.history.length) { body.innerHTML = '<tr><td class="x-empty" colspan="7">Belum ada transaksi.</td></tr>'; return; }
          body.innerHTML = S.history.map(function (h) {
            return '<tr><th scope="row" class="rowhead">' + esc(fmtTime(h.ts)) + "</th>" +
              '<td data-label="Aksi"><span class="' + (h.side === "beli" ? "x-up" : "x-down") + '">' + (h.side === "beli" ? "Beli" : "Jual") + "</span></td>" +
              '<td data-label="Token">' + esc(h.symbol) + "</td>" +
              '<td class="num" data-label="USD">' + fmtUsd(h.usd) + "</td>" +
              '<td data-label="Jumlah token">' + fmtTok(h.tokens) + "</td>" +
              '<td data-label="Harga">' + fmtPrice(h.price) + "</td>" +
              '<td class="muted" data-label="Fee">' + fmtUsd(h.fee) + "</td></tr>";
          }).join("");
        }
        function renderWatchlist() {
          $("watchlist").innerHTML = S.watchlist.map(function (w, i) {
            return '<span class="x-wl__chip' + (w.ca === active ? " is-active" : "") + '"><button type="button" data-load="' + esc(w.ca) + '">' + esc(w.symbol || short(w.ca)) +
              '</button><button type="button" data-wlrm="' + i + '" aria-label="Hapus ' + esc(w.symbol) + ' dari watchlist">×</button></span>';
          }).join("") || '<span class="x-src">Watchlist kosong. Muat token lalu ketuk “+ Watchlist”.</span>';
        }
        function renderAll() { saveState(); renderHeader(); renderWatchlist(); renderToken(); renderChart(); renderTrade(); renderPositions(); renderHistory(); }

        /* ---------- events ---------- */
        /* ---------- search by name / ticker ---------- */
        var searchT = null, searchSeq = 0, lastPairs = null, lastQ = "";
        function hideRes() { var r = $("search-res"); r.hidden = true; r.innerHTML = ""; }
        function age(ts) {
          if (!ts) return "—";
          var m = Math.max(0, (Date.now() - ts) / 60000);
          if (m < 60) return Math.max(1, Math.floor(m)) + " mnt";
          var h = m / 60; if (h < 24) return Math.floor(h) + " jam";
          var d = h / 24; if (d < 30) return Math.floor(d) + " hari";
          if (d < 365) return Math.floor(d / 30) + " bln";
          return Math.floor(d / 365) + " thn";
        }
        function renderRes() {
          var r = $("search-res");
          if (!lastPairs) return;
          var pumpOnly = $("pump-only").checked, best = {};
          lastPairs.forEach(function (p) {
            if (p.chainId !== "solana" || !p.baseToken || !p.baseToken.address) return;
            var a = p.baseToken.address;
            if (pumpOnly && !/pump$/.test(a)) return;
            if (!best[a] || liq(p) > liq(best[a])) best[a] = p;
          });
          var list = Object.keys(best).map(function (k) { return best[k]; })
            .sort(function (a, b) { return ((b.volume && +b.volume.h24) || 0) - ((a.volume && +a.volume.h24) || 0); })
            .slice(0, 10);
          r.hidden = false;
          if (!list.length) { r.innerHTML = '<p class="x-res__msg">Tidak ditemukan' + (pumpOnly ? " (filter pump.fun aktif)" : "") + ".</p>"; return; }
          r.innerHTML = '<ul class="x-res__list">' + list.map(function (p) {
            var t = p.baseToken, a = t.address, img = p.info && p.info.imageUrl;
            var ch = p.priceChange ? +p.priceChange.h24 : NaN;
            var dex = p.dexId === "pumpfun" ? "bonding curve" : (p.dexId || "dex");
            var logo = img ? '<img class="x-logo" src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
              : '<span class="x-logo" aria-hidden="true">' + esc((t.symbol || "?").slice(0, 2)) + "</span>";
            return '<li><button type="button" class="x-res__item" data-res="' + esc(a) + '">' + logo +
              '<span class="x-res__body"><span class="x-res__name">' + esc(t.name || t.symbol) + " <small>" + esc(t.symbol || "") + "</small>" +
              (/pump$/.test(a) ? '<span class="x-badge">pump</span>' : "") + '<span class="x-badge">' + esc(dex) + "</span></span>" +
              '<span class="x-res__meta"><span>MC <b>' + fmtBig(p.marketCap != null ? +p.marketCap : +p.fdv) + "</b></span><span>Vol 24j <b>" + fmtBig(p.volume ? +p.volume.h24 : NaN) +
              '</b></span><span>24j <b class="' + cls(ch) + '">' + fmtPct(ch) + "</b></span><span>Umur <b>" + age(p.pairCreatedAt) + '</b></span><span class="x-res__ca">' + esc(short(a)) + "</span></span></span></button></li>";
          }).join("") + '</ul><p class="x-res__note">Banyak koin punya nama sama — cek CA sebelum beli.</p>';
        }
        function runSearch(q) {
          q = (q || "").trim();
          clearTimeout(searchT);
          if (!q) { searchSeq++; lastPairs = null; hideRes(); return; }
          if (validCA(q)) { searchSeq++; hideRes(); loadToken(q); return; }
          if (q === lastQ && lastPairs) { renderRes(); return; }
          var seq = ++searchSeq, r = $("search-res");
          r.hidden = false; r.innerHTML = '<p class="x-res__msg">Mencari “' + esc(q) + "”…</p>";
          fetchJSON("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q)).then(function (j) {
            if (seq !== searchSeq) return;
            lastQ = q; lastPairs = (j && j.pairs) || []; renderRes();
          }, function (e) {
            if (seq !== searchSeq) return;
            lastPairs = null;
            r.hidden = false; r.innerHTML = '<p class="x-err" role="alert">Gagal mencari: ' + esc(e.rate ? "terlalu banyak permintaan, coba lagi sebentar" : e.message) + ".</p>";
          });
        }
        $("search").addEventListener("submit", function (e) { e.preventDefault(); runSearch($("ca-input").value); });
        $("ca-input").addEventListener("input", function () {
          var q = this.value.trim();
          clearTimeout(searchT);
          if (!q) { runSearch(""); return; }
          if (validCA(q) && q === active) { hideRes(); return; }
          searchT = setTimeout(function () { runSearch(q); }, 400);
        });
        $("ca-input").addEventListener("keydown", function (e) { if (e.key === "Escape") hideRes(); });
        $("pump-only").addEventListener("change", function () { if (lastPairs) renderRes(); });
        $("search-res").addEventListener("click", function (e) {
          var b = e.target.closest("[data-res]");
          if (!b) return;
          searchSeq++; lastPairs = null; hideRes();
          loadToken(b.dataset.res);
          $("ca-input").blur();
        });
        document.addEventListener("click", function (e) {
          var t = e.target.closest("button, [data-copy]");
          if (!t) return;
          var ds = t.dataset;
          if (ds.copy) copyText(ds.copy);
          else if (ds.load) loadToken(ds.load);
          else if (ds.wlrm != null) { S.watchlist.splice(+ds.wlrm, 1); renderWatchlist(); renderToken(); }
          else if (ds.tab) { tab = ds.tab; renderTrade(); }
          else if (ds.amt) { $("buy-amt").value = ds.amt === "max" ? (Math.floor(S.cash * 100) / 100).toFixed(2) : ds.amt; updatePreview(); }
          else if (ds.pct) { sellPct = +ds.pct; renderTrade(); }
          else if (ds.sell || ds.view) {
            var ca = ds.sell || ds.view;
            tab = ds.sell ? "jual" : tab; if (ds.sell) sellPct = 100;
            if (ca !== active) loadToken(ca); else renderAll();
            var target = ds.sell ? $("trade-panel") : $("trade");
            setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
          }
          else if (t.id === "buy-go") buy();
          else if (t.id === "sell-go") sell();
          else if (t.id === "st-refresh") { busy = false; refresh(); }
          else if (t.id === "st-auto") { autoOn = !autoOn; renderToken(); schedule(); toast("Auto-refresh " + (autoOn ? "aktif" : "mati")); }
          else if (t.id === "wl-add") { S.watchlist.push({ ca: active, symbol: symOf(active) }); renderWatchlist(); renderToken(); toast("Ditambahkan ke watchlist"); }
        });
        document.addEventListener("input", function (e) {
          var id = e.target.id;
          if (id === "buy-amt") updatePreview();
          else if (id === "set-fee" || id === "set-slip") {
            var v = num(e.target.value);
            if (isFinite(v)) {
              if (id === "set-fee") S.settings.fee = Math.min(5, Math.max(0, v)); else S.settings.slip = Math.min(50, Math.max(0, v));
              updatePreview();
            }
          }
        });
        document.addEventListener("change", function (e) {
          if (e.target.id === "set-fee") e.target.value = S.settings.fee;
          if (e.target.id === "set-slip") e.target.value = S.settings.slip;
        });

        // starting balance
        $("bal-toggle").addEventListener("click", function () {
          var f = $("bal-form"), open = f.hidden; f.hidden = !open; this.setAttribute("aria-expanded", open);
          if (open) { $("bal-input").value = S.initialCash; $("bal-input").focus(); }
        });
        $("bal-cancel").addEventListener("click", function () { $("bal-form").hidden = true; $("bal-toggle").setAttribute("aria-expanded", "false"); });
        $("bal-apply").addEventListener("click", function () {
          var v = num($("bal-input").value);
          if (!(v > 0)) { toast("Masukkan angka lebih dari 0"); return; }
          var diff = v - S.initialCash;
          if (S.cash + diff < 0) { toast("Kas akan negatif; pilih saldo lebih besar"); return; }
          S.initialCash = v; S.cash += diff;
          $("bal-form").hidden = true; $("bal-toggle").setAttribute("aria-expanded", "false");
          toast("Saldo awal: " + fmtUsd(v)); renderAll();
        });

        // normalisasi data impor / localStorage
        function normState(d) {
          if (!d || typeof d !== "object" || !isFinite(+d.cash) || typeof d.positions !== "object" || !Array.isArray(d.history)) throw new Error("format");
          var n = blankState(isFinite(+d.initialCash) ? +d.initialCash : 100);
          n.cash = +d.cash;
          Object.keys(d.positions || {}).forEach(function (ca) {
            var p = d.positions[ca];
            if (validCA(ca) && p && +p.tokens > 0) n.positions[ca] = { ca: ca, symbol: String(p.symbol || short(ca)), name: String(p.name || p.symbol || ""), tokens: +p.tokens, cost: +p.cost || 0, lastPrice: p.lastPrice != null ? +p.lastPrice : null };
          });
          n.history = d.history.filter(function (h) { return h && isFinite(+h.ts); });
          if (Array.isArray(d.watchlist)) n.watchlist = d.watchlist.filter(function (w) { return w && validCA(w.ca); }).map(function (w) { return { ca: w.ca, symbol: String(w.symbol || short(w.ca)) }; });
          if (d.settings) { n.settings.fee = Math.min(5, Math.max(0, +d.settings.fee || 0)); n.settings.slip = Math.min(50, Math.max(0, +d.settings.slip || 0)); }
          return n;
        }

        // export / import
        $("exp-btn").addEventListener("click", function () {
          $("exp-text").value = JSON.stringify(S, null, 2);
          $("exp-box").hidden = false;
          try { $("exp-text").focus(); $("exp-text").select(); } catch (e) {}
        });
        $("exp-copy").addEventListener("click", function () { copyText($("exp-text").value, $("exp-text")); });
        $("imp-btn").addEventListener("click", function () {
          var msg = $("imp-msg");
          try {
            var d = JSON.parse($("imp-text").value);
            var n = normState(d);
            S = n;
            msg.textContent = "Data berhasil dipulihkan.";
            toast("Impor berhasil"); renderAll(); busy = false; refresh();
          } catch (e) { msg.textContent = "JSON tidak valid. Tempel hasil “Ekspor data” apa adanya."; }
        });

        // ---------- scanner koin KOL ----------
        var SCAN_URLS = ["data/scan.json", "https://raw.githubusercontent.com/sagaevans/Naszcan/main/data/scan.json"];
        var scanData = null, scanLive = {};
        function fetchScan(i) {
          i = i || 0;
          if (i >= SCAN_URLS.length) return Promise.reject(new Error("noscan"));
          return fetch(SCAN_URLS[i] + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("http"); return r.json();
          }).then(function (j) { if (!j || !Array.isArray(j.coins)) throw new Error("format"); return j; })
            .catch(function () { return fetchScan(i + 1); });
        }
        function relTime(sec) {
          if (!sec) return "—";
          var m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
          return m < 60 ? m + " mnt lalu" : Math.floor(m / 60) + " j " + (m % 60) + " m lalu";
        }
        function renderScan() {
          var body = $("scan-body"); if (!body) return;
          if (!scanData) { body.innerHTML = ""; return; }
          var min = +$("scan-min").value, mc = +$("scan-mc").value, hold = $("scan-hold").checked;
          var ageH = +($("scan-age") && $("scan-age").value) || 0, minSol = +($("scan-minsol") && $("scan-minsol").value) || 0;
          var newSince = Date.now() / 1000 - ageH * 3600;
          var rows = scanData.coins.filter(function (c) {
            var live = scanLive[c.ca] || {}, cap = live.marketCap != null ? live.marketCap : live.fdv != null ? live.fdv : c.marketCap;
            if (c.kolWallets < min) return false;
            if (!c.launchedAt && c.pairCreatedAt) c.launchedAt = Math.floor(c.pairCreatedAt / 1000);
            if (ageH > 0 && !(c.launchedAt && c.launchedAt >= newSince)) return false;
            if (minSol > 0 && !(+c.solSpent >= minSol)) return false;
            if (hold && !(c.kolHolders > 0)) return false;
            if (mc && cap != null && cap > mc) return false;
            return true;
          });
          if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="x-src">Tidak ada koin yang cocok dengan filter. Coba longgarkan filter.</td></tr>'; return; }
          body.innerHTML = rows.slice(0, 30).map(function (c) {
            var live = scanLive[c.ca] || {};
            var cap = live.marketCap != null ? live.marketCap : live.fdv != null ? live.fdv : c.marketCap;
            var ch = live.ch1h != null ? live.ch1h : c.change1h;
            var sym = live.symbol || c.symbol || short(c.ca);
            var img = live.imageUrl || c.imageUrl;
            return "<tr>" +
              '<td><span class="x-scan-tok">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy"/>' : "") + "<span><b>" + esc(sym) + '</b><br/><button type="button" class="x-link" data-copy="' + esc(c.ca) + '">' + esc(short(c.ca)) + "</button></span></span></td>" +
              "<td>" + (c.launchedAt ? relTime(c.launchedAt) : "—") + "</td>" +
              "<td>" + c.kolWallets + (c.kolHolders ? ' <span class="x-src">(' + c.kolHolders + " pegang)</span>" : "") + "</td>" +
              "<td>" + (+c.solSpent).toFixed(2) + " SOL</td>" +
              "<td>" + fmtBig(cap) + "</td>" +
              '<td class="' + (ch > 0 ? "pos" : ch < 0 ? "neg" : "") + '">' + fmtPct(ch) + "</td>" +
              "<td>" + relTime(c.lastBuy) + "</td>" +
              '<td><button class="x-b x-b--sm" type="button" data-load="' + esc(c.ca) + '" data-scroll="trade">Muat</button></td>' +
              "</tr>";
          }).join("");
        }
        // Scan langsung di browser: daftar wallet dari data/wallets.json (diperbarui GitHub Actions),
        // transaksi dari Solana RPC publik (CORS diizinkan), harga dari DexScreener.
        var WALLET_URLS = ["data/wallets.json", "https://raw.githubusercontent.com/sagaevans/Naszcan/main/data/wallets.json"];
        var SCAN_SKIP = { "So11111111111111111111111111111111111111112": 1, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 1, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": 1 };
        var scanRun = 0;
        function fetchFirst(urls, i) {
          i = i || 0;
          if (i >= urls.length) return Promise.reject(new Error("nofile"));
          return fetch(urls[i] + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
            .catch(function () { return fetchFirst(urls, i + 1); });
        }
        function loadWallets() {
          return fetchFirst(WALLET_URLS).then(function (j) { if (!j || !j.wallets || !j.wallets.length) throw new Error("x"); return j.wallets; })
            .catch(function () {
              return fetchScan().then(function (j) {
                var m = {}, list = [];
                (j.wallets || []).forEach(function (w) { if (!m[w.wallet]) { m[w.wallet] = 1; list.push(w); } });
                j.coins.forEach(function (c) { (c.buyers || []).forEach(function (b) { if (!m[b.wallet]) { m[b.wallet] = 1; list.push({ wallet: b.wallet, rank: b.rank }); } }); });
                if (!list.length) throw new Error("nowallet");
                return list.sort(function (x, y) { return x.rank - y.rank; });
              });
            });
        }
        function rpcRetry(method, params, tries) {
          tries = tries || 0;
          return fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }) })
            .then(function (r) { if (r.status === 429 || r.status >= 500) throw new Error("rate"); return r.json(); })
            .then(function (j) { if (j.error) { if (/limit|too many/i.test(j.error.message || "")) throw new Error("rate"); return null; } return j.result; })
            .catch(function () {
              if (tries >= 4) return null;
              return new Promise(function (res) { setTimeout(res, 800 * (tries + 1)); }).then(function () { return rpcRetry(method, params, tries + 1); });
            });
        }
        function pool(items, n, fn) {
          var i = 0;
          function worker() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(items[k], k)).then(worker); }
          var ws = []; for (var w = 0; w < n; w++) ws.push(worker());
          return Promise.all(ws);
        }
        function txDeltas(tx, wallet) {
          if (!tx || !tx.meta || tx.meta.err) return null;
          var keys = tx.transaction.message.accountKeys.map(function (k) { return typeof k === "string" ? k : k.pubkey; });
          var idx = keys.indexOf(wallet), sol = 0, tok = {};
          if (idx >= 0) sol += (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
          function add(bal, sign) {
            if (!bal || bal.owner !== wallet) return;
            var amt = uiAmt(bal);
            if (bal.mint === SOL_MINT) { sol += sign * amt; return; }
            tok[bal.mint] = (tok[bal.mint] || 0) + sign * amt;
          }
          (tx.meta.preTokenBalances || []).forEach(function (x) { add(x, -1); });
          (tx.meta.postTokenBalances || []).forEach(function (x) { add(x, 1); });
          return { sol: sol, tok: tok, time: tx.blockTime };
        }
        function liveScan(hours, wallets, onProgress, run) {
          var since = Math.floor(Date.now() / 1000) - Math.round(hours * 3600);
          var jobs = [], doneW = 0, doneT = 0, per = {};
          return pool(wallets, 6, function (w) {
            if (run !== scanRun) return;
            return rpcRetry("getSignaturesForAddress", [w.wallet, { limit: 1000 }]).then(function (sigs) {
              (sigs || []).forEach(function (s) { if (!s.err && s.blockTime && s.blockTime >= since) jobs.push({ w: w, sig: s.signature }); });
              doneW++; onProgress("Mengambil transaksi wallet " + doneW + "/" + wallets.length + "…");
            });
          }).then(function () {
            if (run !== scanRun) return null;
            return pool(jobs, 12, function (job) {
              if (run !== scanRun) return;
              return rpcRetry("getTransaction", [job.sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).then(function (tx) {
                doneT++; if (doneT % 10 === 0 || doneT === jobs.length) onProgress("Membaca transaksi " + doneT + "/" + jobs.length + "…");
                var d = txDeltas(tx, job.w.wallet); if (!d) return;
                var mints = Object.keys(d.tok).filter(function (m) { return !SCAN_SKIP[m] && Math.abs(d.tok[m]) > 0; });
                if (mints.length !== 1) return;
                var mint = mints[0], amt = d.tok[mint], key = job.w.wallet + "|" + mint;
                var p = per[key] || (per[key] = { w: job.w, mint: mint, spent: 0, received: 0, bought: 0, sold: 0, first: d.time, last: d.time });
                if (amt > 0 && d.sol < 0) { p.spent += -d.sol; p.bought += amt; }
                else if (amt < 0 && d.sol > 0) { p.received += d.sol; p.sold += -amt; }
                p.first = Math.min(p.first, d.time); p.last = Math.max(p.last, d.time);
              });
            });
          }).then(function () {
            if (run !== scanRun) return null;
            var agg = {};
            Object.keys(per).forEach(function (k) {
              var p = per[k]; if (p.spent <= 0 || !/pump$/.test(p.mint)) return;
              var a = agg[p.mint] || (agg[p.mint] = { ca: p.mint, kolWallets: 0, kolHolders: 0, solSpent: 0, solReceived: 0, firstBuy: p.first, lastBuy: p.last, buyers: [] });
              var held = p.bought > 0 ? Math.max(0, 1 - p.sold / p.bought) : 0;
              a.kolWallets++; if (held >= 0.5) a.kolHolders++;
              a.solSpent += p.spent; a.solReceived += p.received;
              a.firstBuy = Math.min(a.firstBuy, p.first); a.lastBuy = Math.max(a.lastBuy, p.last);
              a.buyers.push({ wallet: p.w.wallet, rank: p.w.rank, sol: +p.spent.toFixed(3), held: +held.toFixed(2) });
            });
            var coins = Object.keys(agg).map(function (k) {
              var a = agg[k];
              a.score = a.kolWallets * 10 + a.kolHolders * 8 + Math.log(1 + a.solSpent) / Math.LN10 * 12;
              return a;
            }).sort(function (x, y) { return y.score - x.score; });
            onProgress("Mengecek waktu launching " + coins.length + " koin…");
            return launchTimes(coins.map(function (c) { return c.ca; })).then(function (lt) {
              coins.forEach(function (c) { c.launchedAt = lt[c.ca] || null; });
              return { generatedAt: new Date().toISOString(), hours: hours, walletsScanned: wallets.length, txParsed: jobs.length, coins: coins, live: true };
            });
          });
        }
        // Waktu launching = pairCreatedAt paling awal dari semua pair token (pair bonding curve pump.fun)
        function launchTimes(cas) {
          var chunks = []; for (var i = 0; i < cas.length; i += 30) chunks.push(cas.slice(i, i + 30));
          var out = {};
          return pool(chunks, 3, function (ch) {
            return fetch(DS + ch.join(",")).then(function (r) { return r.json(); }).then(function (arr) {
              (Array.isArray(arr) ? arr : []).forEach(function (p) {
                var ca = p.baseToken && p.baseToken.address, t = p.pairCreatedAt;
                if (!ca || !t) return;
                t = Math.floor(t / 1000);
                if (!out[ca] || t < out[ca]) out[ca] = t;
              });
            }).catch(function () {});
          }).then(function () { return out; });
        }
        function fillLive(j, meta) {
          var cas = j.coins.map(function (c) { return c.ca; });
          if (!cas.length) return Promise.resolve();
          return fetchBatch(cas).catch(function () { return {}; }).then(function (m) {
            Object.keys(m || {}).forEach(function (ca) { if (m[ca]) { scanLive[ca] = m[ca]; if (!info[ca]) info[ca] = m[ca]; } });
            renderScan();
          });
        }
        function runScan() {
          var btn = $("scan-btn"), meta = $("scan-meta");
          if (btn.getAttribute("data-busy")) { scanRun++; btn.removeAttribute("data-busy"); btn.textContent = "Scan koin"; meta.textContent = "Scan dihentikan."; return; }
          var run = ++scanRun, hours = Math.min(6, Math.max(0.25, +($("scan-hours") ? $("scan-hours").value : 2) || 2)), t0 = Date.now();
          btn.setAttribute("data-busy", "1"); btn.textContent = "Berhenti";
          meta.textContent = "Memuat daftar wallet KOL…";
          var label = hours < 1 ? Math.round(hours * 60) + " menit" : hours + " jam";
          loadWallets().then(function (wallets) {
            var maxW = Math.max(1, Math.round(+($("scan-wallets") && $("scan-wallets").value) || 50));
            return liveScan(hours, wallets.slice(0, maxW), function (t) { if (run === scanRun) meta.textContent = t; }, run);
          }).then(function (j) {
            if (!j || run !== scanRun) return;
            scanData = j; scanLive = {};
            var secs = Math.round((Date.now() - t0) / 1000);
            meta.textContent = "Scan langsung " + new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) + " WIB · " + j.walletsScanned + " wallet · " + label + " terakhir · " + j.txParsed + " transaksi · " + j.coins.length + " koin · " + secs + " dtk.";
            renderScan();
            return fillLive(j, meta);
          }).catch(function () {
            if (run !== scanRun) return;
            meta.textContent = "Scan langsung gagal (RPC sibuk atau daftar wallet belum ada). Memuat hasil GitHub Actions terakhir…";
            return fetchScan().then(function (j) {
              scanData = j; scanLive = {};
              meta.textContent = "Hasil GitHub Actions " + new Date(j.generatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " WIB · " + j.coins.length + " koin.";
              renderScan(); return fillLive(j, meta);
            }).catch(function () { meta.textContent = "Scan gagal. Coba lagi sebentar lagi."; });
          }).then(function () {
            if (run === scanRun) { btn.removeAttribute("data-busy"); btn.textContent = "Scan koin"; }
          });
        }
        $("scan-btn").addEventListener("click", runScan);
        ["scan-min", "scan-mc", "scan-hold", "scan-age", "scan-minsol"].forEach(function (id) { $(id).addEventListener("change", renderScan); $(id).addEventListener("input", renderScan); });
        document.addEventListener("click", function (e) {
          var b = e.target.closest && e.target.closest("[data-scroll]"); if (!b) return;
          var el = $(b.getAttribute("data-scroll")); if (el) setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
        });

        // tombol timeframe grafik
        document.addEventListener("click", function (e) {
          var b = e.target.closest && e.target.closest("[data-tf]"); if (!b) return;
          chartTf = b.getAttribute("data-tf");
          Array.prototype.forEach.call(document.querySelectorAll("[data-tf]"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          renderChart();
        });

        // reset
        $("reset-btn").addEventListener("click", function () { $("reset-confirm").hidden = false; this.hidden = true; });
        $("reset-no").addEventListener("click", function () { $("reset-confirm").hidden = true; $("reset-btn").hidden = false; });
        $("reset-yes").addEventListener("click", function () {
          var wl = S.watchlist; S = blankState(100); S.watchlist = wl;
          $("reset-confirm").hidden = true; $("reset-btn").hidden = false;
          toast("Direset ke $100"); renderAll();
        });

        // simpan otomatis (localStorage)
        function saveState() { try { localStorage.setItem("naszcan-sim-v1", JSON.stringify(S)); } catch (e) {} }
        try { var raw = localStorage.getItem("naszcan-sim-v1"); if (raw) S = normState(JSON.parse(raw)); } catch (e) { /* data rusak: pakai data awal */ }
        setInterval(saveState, 5000);
        window.addEventListener("beforeunload", saveState);
        document.addEventListener("visibilitychange", function () { if (document.hidden) saveState(); });

        var note = document.querySelector(".head__sub[data-store-note]");
        if (note) note.textContent = CAN_STORE ? "Data tersimpan otomatis di browser ini. Ekspor untuk cadangan atau pindah perangkat." : "Mode Hark Page: data hanya ada selama tab ini terbuka (Hark tidak mengizinkan penyimpanan browser). Ekspor sebelum menutup, Impor saat membuka lagi.";

        setInterval(renderStatus, 1000);
        active = SLING;
        $("ca-input").value = SLING;
        renderAll();
        refresh();
      })();
    