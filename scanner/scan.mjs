// NasZcan coin scanner
// Membaca wallet top leaderboard Kolscan, transaksi N jam terakhir via Solana RPC,
// menjumlahkan SOL yang dibelanjakan per token pump.fun, lalu memperkaya dengan DexScreener.
// Output: data/scan.json
// Jalankan: node scanner/scan.mjs   (Node 18+)
// Env opsional: RPC_URL (mis. Helius), HOURS (default 12), MAX_WALLETS (default 100),
//               MAX_TX_PER_WALLET (default 500), CONCURRENCY (default 8), OUT (default data/scan.json)

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const RPC_URL = (process.env.RPC_URL || "").trim() || "https://solana-rpc.publicnode.com";
const HOURS = +(process.env.HOURS || 12);
const MAX_WALLETS = +(process.env.MAX_WALLETS || 100);
const MAX_TX = +(process.env.MAX_TX_PER_WALLET || 500);
const CONC = +(process.env.CONCURRENCY || 8);
const OUT = process.env.OUT || "data/scan.json";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLES = new Set([SOL_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const UA = { "user-agent": "Mozilla/5.0 (NasZcan scanner; +https://github.com/sagaevans/Naszcan)" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

async function rpcOne(method, params, tries = 6) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; }
      const j = await r.json();
      if (j.error) { if (/limit|too many/i.test(j.error.message || "")) { await sleep(1000 * (t + 1)); continue; } return null; }
      return j.result ?? null;
    } catch (e) { await sleep(1000 * (t + 1)); }
  }
  return null;
}

async function kolscanWallets() {
  const r = await fetch("https://kolscan.io/leaderboard", { headers: UA });
  const html = await r.text();
  const seen = new Map();
  // Nama KOL muncul dekat tautan akun; ambil alamat dulu, nama sebisanya.
  const re = /href="\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})[^"]*"/g;
  let m;
  while ((m = re.exec(html))) { if (!seen.has(m[1])) seen.set(m[1], { wallet: m[1], rank: seen.size + 1 }); }
  return [...seen.values()].slice(0, MAX_WALLETS);
}

async function walletSignatures(wallet, sinceSec) {
  const sigs = [];
  let before;
  while (sigs.length < MAX_TX) {
    const res = await rpcOne("getSignaturesForAddress", [wallet, { limit: Math.min(1000, MAX_TX - sigs.length), ...(before ? { before } : {}) }]);
    if (!res || !res.length) break;
    let stop = false;
    for (const s of res) {
      if (s.blockTime && s.blockTime < sinceSec) { stop = true; break; }
      if (!s.err) sigs.push(s.signature);
    }
    if (stop || res.length < Math.min(1000, MAX_TX - (sigs.length - res.length))) break;
    before = res[res.length - 1].signature;
  }
  return sigs;
}

// Perubahan SOL (lamports, termasuk WSOL) dan token milik wallet dalam satu transaksi
function walletDeltas(tx, wallet) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const idx = keys.indexOf(wallet);
  let sol = 0;
  if (idx >= 0) sol += (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
  const tok = {};
  const add = (b, sign) => {
    if (!b || b.owner !== wallet) return;
    const amt = +(b.uiTokenAmount.uiAmountString || b.uiTokenAmount.uiAmount || 0);
    if (b.mint === SOL_MINT) { sol += sign * amt; return; }
    tok[b.mint] = (tok[b.mint] || 0) + sign * amt;
  };
  (tx.meta.preTokenBalances || []).forEach((b) => add(b, -1));
  (tx.meta.postTokenBalances || []).forEach((b) => add(b, +1));
  return { sol, tok, time: tx.blockTime };
}

async function dexInfo(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + chunk.join(","));
      const arr = await r.json();
      for (const p of Array.isArray(arr) ? arr : []) {
        const ca = p.baseToken && p.baseToken.address; if (!ca || !chunk.includes(ca)) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        if (out[ca] && (out[ca]._liq || 0) >= liq) continue;
        out[ca] = {
          _liq: liq, symbol: p.baseToken.symbol, name: p.baseToken.name, pairAddress: p.pairAddress, dexId: p.dexId, url: p.url,
          priceUsd: p.priceUsd ? +p.priceUsd : null, marketCap: p.marketCap || p.fdv || null, liquidityUsd: liq || null,
          volume24h: p.volume && p.volume.h24, change1h: p.priceChange && p.priceChange.h1, change24h: p.priceChange && p.priceChange.h24,
          imageUrl: p.info && p.info.imageUrl, pairCreatedAt: p.pairCreatedAt || null
        };
      }
    } catch (e) { log("dexscreener gagal", e.message); }
    await sleep(300);
  }
  return out;
}

async function main() {
  const started = Date.now();
  const sinceSec = Math.floor(started / 1000) - HOURS * 3600;
  const wallets = await kolscanWallets();
  log("wallet:", wallets.length);
  if (!wallets.length) throw new Error("Leaderboard Kolscan kosong / berubah format");

  const agg = {}; // mint -> stats
  let txCount = 0;
  for (const w of wallets) {
    const sigs = await walletSignatures(w.wallet, sinceSec);
    const per = {}; // mint -> {spent, received, bought, sold, first}
    for (let i = 0; i < sigs.length; i += CONC) {
      const txs = await Promise.all(sigs.slice(i, i + CONC).map((sig) => rpcOne("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }])));
      for (const tx of txs) {
        const d = walletDeltas(tx, w.wallet); if (!d) continue;
        txCount++;
        const mints = Object.keys(d.tok).filter((m) => !STABLES.has(m) && Math.abs(d.tok[m]) > 0);
        if (mints.length !== 1) continue; // hanya swap sederhana SOL <-> 1 token
        const mint = mints[0], amt = d.tok[mint];
        const p = per[mint] || (per[mint] = { spent: 0, received: 0, bought: 0, sold: 0, first: d.time, last: d.time });
        if (amt > 0 && d.sol < 0) { p.spent += -d.sol; p.bought += amt; }
        else if (amt < 0 && d.sol > 0) { p.received += d.sol; p.sold += -amt; }
        p.first = Math.min(p.first, d.time); p.last = Math.max(p.last, d.time);
      }
    }
    for (const [mint, p] of Object.entries(per)) {
      if (p.spent <= 0) continue;
      const a = agg[mint] || (agg[mint] = { ca: mint, wallets: 0, holders: 0, solSpent: 0, solReceived: 0, firstBuy: p.first, lastBuy: p.last, buyers: [] });
      a.wallets++; a.solSpent += p.spent; a.solReceived += p.received;
      const holding = p.bought > 0 ? Math.max(0, 1 - p.sold / p.bought) : 0;
      if (holding >= 0.5) a.holders++;
      a.firstBuy = Math.min(a.firstBuy, p.first); a.lastBuy = Math.max(a.lastBuy, p.last);
      a.buyers.push({ wallet: w.wallet, rank: w.rank, sol: +p.spent.toFixed(3), held: +holding.toFixed(2) });
    }
    log(`#${w.rank} ${w.wallet.slice(0, 6)} tx=${sigs.length} token=${Object.keys(per).length}`);
  }

  let list = Object.values(agg).filter((a) => a.ca.endsWith("pump"));
  list.sort((a, b) => b.wallets - a.wallets || b.solSpent - a.solSpent);
  list = list.slice(0, 60);
  const info = await dexInfo(list.map((a) => a.ca));
  const coins = list.map((a) => {
    const d = info[a.ca] || {};
    delete d._liq;
    const score = a.wallets * 10 + a.holders * 8 + Math.log10(1 + a.solSpent) * 12 - Math.max(0, (d.change24h || 0) / 50);
    return {
      ca: a.ca, ...d, kolWallets: a.wallets, kolHolders: a.holders,
      solSpent: +a.solSpent.toFixed(3), solReceived: +a.solReceived.toFixed(3), netSol: +(a.solSpent - a.solReceived).toFixed(3),
      firstBuy: a.firstBuy, lastBuy: a.lastBuy, score: +score.toFixed(1),
      buyers: a.buyers.sort((x, y) => y.sol - x.sol).slice(0, 10)
    };
  }).sort((a, b) => b.score - a.score);

  const out = {
    generatedAt: new Date().toISOString(), hours: HOURS, source: "kolscan.io/leaderboard (harian)", walletsScanned: wallets.length,
    txParsed: txCount, tookSec: Math.round((Date.now() - started) / 1000), coins
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1));
  log(`selesai: ${coins.length} koin, ${txCount} tx, ${out.tookSec}s -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
